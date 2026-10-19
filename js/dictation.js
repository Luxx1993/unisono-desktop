/*
 * Page "Diktat": speak, the AI tidies the text, it lands in the clipboard.
 *
 * Flow: record (own light recorder, no on-site extras) → transcribe with the chosen engine
 * (Unisono.apis[…].transcribe, no speaker separation) → clean up with a style via Anthropic or OpenAI
 * (Unisono.summary.complete) → apply the find-and-replace rules → show, copy, keep in the history.
 *
 * Operation: "Antippen" (start and stop with a click or the space bar) or "Halten" (hold the button or
 * the space bar). The space bar works while this page is open and no text field has the focus.
 * Everything is stored in this browser: settings, own styles, replacement rules and the last 50 dictations.
 *
 * The logic without a page (styles, prompt, rules, history list) is in dictation-core.js.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const core = S.dictationCore;
    const $ = id => document.getElementById(id);

    const CONFIG_KEY = 'unisono_dictation';
    const STYLES_KEY = 'unisono_dictation_styles';
    const HISTORY_KEY = 'unisono_dictation_history';
    const REPLACEMENTS_KEY = 'unisono_replacements';

    const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    const BITRATE = 64000;
    const MIN_SECONDS = 0.7;          // shorter takes are accidents
    const LLM_DEFAULTS = { anthropic: 'claude-haiku-5-5', openai: 'gpt-5-mini' };
    const MAX_TERMS_FOR_CLEANUP = 100;

    const config = {
        engine: null, model: null, language: 'de', mode: 'tap',
        style: 'cleanup', llmProvider: 'anthropic', llmModel: LLM_DEFAULTS.anthropic, autoCopy: true
    };
    let customStyles = [];
    let history = [];
    let rules = [];

    let phase = 'idle';        // 'idle' | 'starting' | 'recording' | 'working'
    let rec = null;            // the running recording
    let pendingEnd = null;     // 'stop' | 'cancel': the key was let go (or Esc pressed) while the microphone was still opening
    let abortController = null;
    let last = null;           // { source, raw, text, styleId, styleName, seconds, view: 'text' | 'raw' }
    let editingStyleId = null;

    // --- Tiny DOM helper ---
    function el(tag, props = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v == null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else if (k in node && k !== 'list') node[k] = v;
            else node.setAttribute(k, v);
        }
        node.append(...children.filter(c => c != null && c !== false));
        return node;
    }

    // --- Storage (may be unavailable, e.g. in private mode) ---
    function read(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key));
            return value ?? fallback;
        } catch (_) {
            return fallback;
        }
    }

    function write(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    }

    function loadAll() {
        Object.assign(config, read(CONFIG_KEY, {}));
        customStyles = core.sanitizeCustomStyles(read(STYLES_KEY, []));
        history = core.sanitizeHistory(read(HISTORY_KEY, []));
        rules = core.sanitizeRules(read(REPLACEMENTS_KEY, []));
        if (!S.apis[config.engine]) config.engine = null;
        if (config.mode !== 'hold') config.mode = 'tap';
        if (!LLM_DEFAULTS[config.llmProvider]) config.llmProvider = 'anthropic';
        if (!config.llmModel) config.llmModel = LLM_DEFAULTS[config.llmProvider];
        if (config.style !== core.RAW_STYLE_ID && !core.findStyle(config.style, customStyles)) config.style = 'cleanup';
        if (!config.engine) config.engine = pickEngine();
        const api = S.apis[config.engine];
        if (!api.models.some(m => m.id === config.model)) config.model = api.models[0].id;
    }

    const saveConfig = () => write(CONFIG_KEY, config);

    // The first engine with a key, ElevenLabs preferred: its answer comes in one step, which suits a dictation.
    function pickEngine() {
        const ids = Object.keys(S.apis);
        return ['elevenlabs', ...ids].find(id => S.apis[id] && S.ui.hasKey(id)) || (S.apis.elevenlabs ? 'elevenlabs' : ids[0]);
    }

    const viewVisible = () => !$('view-dictation').classList.contains('hidden');
    const isActive = () => phase === 'recording' || phase === 'starting';

    function formatTime(seconds) {
        const s = Math.max(0, Math.floor(seconds));
        return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }

    // --- Recording ---------------------------------------------------------------------------
    function pickMimeType() {
        return MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
    }

    function extensionFor(mime) {
        if (mime.includes('mp4')) return 'm4a';
        if (mime.includes('ogg')) return 'ogg';
        return 'webm';
    }

    function micMessage(err) {
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
            return 'Der Zugriff auf das Mikrofon wurde nicht erlaubt. Bitte im Browser für diese Seite freigeben.';
        }
        if (err?.name === 'NotFoundError') return 'Kein Mikrofon gefunden.';
        return 'Das Mikrofon lässt sich nicht öffnen: ' + (err?.message || err);
    }

    async function startRecording() {
        if (phase !== 'idle') return;
        if (S.recorder.isActive()) {
            return S.ui.setStatus('Unter „Aufnahme“ läuft gerade eine Aufnahme. Bitte zuerst beenden.', 'error');
        }
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
            return S.ui.setStatus('Dieser Browser unterstützt keine Aufnahme über das Mikrofon.', 'error');
        }
        if (!S.ui.hasKey(config.engine)) {
            return S.ui.setStatus(`Bitte zuerst den API-Key für ${S.apis[config.engine].label} unter „API-Keys“ eintragen.`, 'error');
        }
        pendingEnd = null;
        setPhase('starting');
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
        } catch (err) {
            setPhase('idle');
            return S.ui.setStatus(micMessage(err), 'error');
        }
        try {
            rec = openRecording(stream);
        } catch (err) {
            stream.getTracks().forEach(t => t.stop());
            setPhase('idle');
            return S.ui.setStatus('Die Aufnahme lässt sich nicht starten: ' + err.message, 'error');
        }
        setPhase('recording');
        if (pendingEnd === 'stop') stopRecording();
        else if (pendingEnd === 'cancel') cancel();
        pendingEnd = null;
    }

    function openRecording(stream) {
        const mime = pickMimeType();
        const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: BITRATE } : { audioBitsPerSecond: BITRATE });
        const r = { stream, recorder, chunks: [], mime: recorder.mimeType || mime, startedAt: performance.now(), timer: null, frame: null, ctx: null };
        recorder.ondataavailable = e => { if (e.data.size) r.chunks.push(e.data); };
        recorder.start(1000);

        // Level meter
        try {
            r.ctx = new (window.AudioContext || window.webkitAudioContext)();
            const analyser = r.ctx.createAnalyser();
            analyser.fftSize = 512;
            r.ctx.createMediaStreamSource(stream).connect(analyser);
            const data = new Uint8Array(analyser.fftSize);
            const bar = $('dict-level');
            const tick = () => {
                analyser.getByteTimeDomainData(data);
                let sum = 0;
                for (const v of data) sum += ((v - 128) / 128) ** 2;
                bar.style.transform = `scaleX(${Math.min(1, Math.sqrt(sum / data.length) * 4).toFixed(3)})`;
                r.frame = requestAnimationFrame(tick);
            };
            tick();
        } catch (_) {}

        const clock = $('dict-time');
        r.timer = setInterval(() => { clock.textContent = formatTime((performance.now() - r.startedAt) / 1000); }, 250);
        return r;
    }

    function closeRecording(r) {
        clearInterval(r.timer);
        cancelAnimationFrame(r.frame);
        r.stream.getTracks().forEach(t => t.stop());
        r.ctx?.close().catch(() => {});
        $('dict-level').style.transform = 'scaleX(0)';
        $('dict-time').textContent = '00:00';
    }

    // Stops the running recording and returns its audio (null when discarded).
    function finishRecording(discard) {
        const r = rec;
        rec = null;
        return new Promise(resolve => {
            const seconds = (performance.now() - r.startedAt) / 1000;
            const done = () => {
                closeRecording(r);
                resolve(discard ? null : { blob: new Blob(r.chunks, { type: r.mime }), seconds, mime: r.mime });
            };
            if (r.recorder.state === 'inactive') return done();
            r.recorder.onstop = done;
            r.recorder.stop();
        });
    }

    async function stopRecording() {
        if (phase === 'starting') { pendingEnd = 'stop'; return; }
        if (phase !== 'recording') return;
        const audio = await finishRecording(false);
        if (!audio || audio.seconds < MIN_SECONDS || audio.blob.size < 1000) {
            setPhase('idle');
            return S.ui.setStatus(config.mode === 'hold'
                ? 'Zu kurz. Zum Diktieren die Taste gedrückt halten, solange du sprichst.'
                : 'Zu kurz, es wurde nichts aufgenommen.', 'note');
        }
        transcribeAndDeliver(audio);
    }

    async function cancel() {
        if (phase === 'starting') { pendingEnd = 'cancel'; return; }
        if (phase === 'recording') {
            await finishRecording(true);
            setPhase('idle');
            S.ui.setStatus('Diktat verworfen.', 'note');
        } else if (phase === 'working') {
            abortController?.abort();
        }
    }

    // --- Transcribe, clean up, deliver -------------------------------------------------------------
    async function transcribeAndDeliver({ blob, seconds, mime }) {
        setPhase('working');
        abortController = new AbortController();
        const { signal } = abortController;
        const api = S.apis[config.engine];
        try {
            const key = S.ui.getKey(config.engine);
            const file = new File([blob], `diktat.${extensionFor(mime)}`, { type: mime });
            const support = api.vocabularySupport?.(config.model);
            const vocabulary = support ? S.vocabulary.prepare(S.vocabulary.getTerms(), support).terms : [];
            S.ui.setStatus(`Transkribiere mit ${shortLabel(api)} …`);
            const result = await api.transcribe(file, {
                key, model: config.model, language: config.language, diarize: false, speakers: null,
                vocabulary, signal, onStage: (stage, text) => S.ui.setStatus(text), onUpload: () => {}
            });
            const source = core.joinSegments(result.segments);
            if (!source) {
                setPhase('idle');
                return S.ui.setStatus('Es wurde nichts erkannt. Bitte lauter oder näher am Mikrofon sprechen.', 'note');
            }
            await deliver(source, seconds, config.style, signal);
        } catch (err) {
            if (err.name === 'AbortError') S.ui.setStatus('Diktat abgebrochen.', 'note');
            else S.ui.showError('Diktat fehlgeschlagen', err);
        } finally {
            abortController = null;
            setPhase('idle');
        }
    }

    const shortLabel = api => api.label.split(' (')[0];

    // The raw text → the finished text of a style (on failure: the raw text, with the reason in the status line).
    async function tidy(source, styleId, signal) {
        const style = styleId === core.RAW_STYLE_ID ? null : core.findStyle(styleId, customStyles);
        if (!style) return { text: source, styleName: 'Rohtext', failed: false };
        S.ui.setStatus(`Räume auf (${style.name}) mit ${config.llmModel} …`);
        try {
            const key = S.ui.getKey(config.llmProvider);
            const terms = S.vocabulary.getTerms().slice(0, MAX_TERMS_FOR_CLEANUP);
            const answer = await S.summary.complete({
                provider: config.llmProvider, key, model: config.llmModel,
                system: core.buildSystemPrompt(style.prompt, terms),
                user: core.buildUserMessage(source)
            });
            if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
            return { text: core.cleanModelOutput(answer) || source, styleName: style.name, failed: false };
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            S.ui.showError('Aufräumen nicht möglich, der Rohtext steht bereit', err);
            return { text: source, styleName: 'Rohtext', failed: true, error: err };
        }
    }

    async function deliver(source, seconds, styleId, signal) {
        const tidied = await tidy(source, styleId, signal);
        const entry = {
            source,
            raw: core.applyReplacements(source, rules),
            text: core.applyReplacements(tidied.text, rules),
            styleId: tidied.failed ? core.RAW_STYLE_ID : styleId,
            styleName: tidied.styleName,
            seconds,
            view: 'text'
        };
        showResult(entry);
        remember(entry);
        // A failed clean-up keeps its message in the status line; the copy then happens without a note.
        const copied = config.autoCopy && await copyQuietly(entry.text);
        if (tidied.failed) return;
        if (!config.autoCopy) S.ui.setStatus('Fertig.', 'success');
        else if (copied) S.ui.setStatus('Fertig. Der Text liegt in der Zwischenablage.', 'success');
        else S.ui.setStatus('Fertig. Der Browser hat das automatische Kopieren blockiert, bitte „Kopieren“ klicken.', 'note');
    }

    async function copyQuietly(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) {
            return false;
        }
    }

    function remember(entry) {
        history = core.addToHistory(history, {
            id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            at: Date.now(),
            style: entry.styleId,
            styleName: entry.styleName,
            raw: entry.raw,
            text: entry.text,
            seconds: Math.round(entry.seconds)
        });
        write(HISTORY_KEY, history);
        renderHistory();
        S.settings?.refresh();
    }

    // --- Result card ---------------------------------------------------------------------------
    function showResult(entry) {
        last = entry;
        $('dict-result').classList.remove('hidden');
        renderResult();
    }

    function renderResult() {
        if (!last) return;
        const differs = last.raw !== last.text;
        const view = differs ? last.view : 'text';
        $('dict-text').value = view === 'raw' ? last.raw : last.text;
        const toggle = $('dict-view');
        toggle.classList.toggle('hidden', !differs);
        toggle.replaceChildren(...[['text', last.styleName], ['raw', 'Rohtext']].map(([id, label]) =>
            el('button', {
                type: 'button', role: 'radio', 'aria-checked': String(id === view), text: label,
                onclick: () => { last.view = id; renderResult(); }
            })));
        const words = core.wordCount($('dict-text').value);
        $('dict-meta').textContent = [
            `${words} Wort${words === 1 ? '' : 'e'}`,
            last.seconds ? formatTime(last.seconds) : null,
            view === 'raw' ? 'Rohtext' : last.styleName
        ].filter(Boolean).join(' · ');
        $('dict-rerun-style').value = last.styleId === core.RAW_STYLE_ID ? config.style : last.styleId;
    }

    async function rerun() {
        if (!last || phase !== 'idle') return;
        const styleId = $('dict-rerun-style').value;
        setPhase('working');
        abortController = new AbortController();
        try {
            await deliver(last.source, last.seconds, styleId, abortController.signal);
        } catch (err) {
            if (err.name === 'AbortError') S.ui.setStatus('Abgebrochen.', 'note');
            else S.ui.showError('Aufräumen fehlgeschlagen', err);
        } finally {
            abortController = null;
            setPhase('idle');
        }
    }

    // --- Phase → UI ---------------------------------------------------------------------------
    function setPhase(next) {
        phase = next;
        const recording = phase === 'recording';
        const busy = phase === 'working';
        const hold = config.mode === 'hold';
        $('dict-recorder').classList.toggle('is-recording', recording);
        document.documentElement.classList.toggle('is-dictating', recording || phase === 'starting');
        $('dict-state').textContent = { starting: 'Mikrofon wird geöffnet …', recording: 'Aufnahme läuft', working: 'Wird verarbeitet …' }[phase] || 'Bereit';
        const button = $('dict-main');
        button.disabled = busy;
        $('dict-main-text').textContent = busy ? 'Einen Moment …'
            : recording ? (hold ? 'Loslassen zum Beenden' : 'Stoppen')
            : hold ? 'Zum Diktieren halten' : 'Diktat starten';
        S.setIcon(button.querySelector('.icon'), recording ? 'stop' : 'mic');
        $('dict-cancel').classList.toggle('is-invisible', phase === 'idle' || phase === 'starting');
        $('dict-cancel').textContent = busy ? 'Abbrechen' : 'Verwerfen';
        $('dict-rerun').disabled = phase !== 'idle';
        refreshHints();
    }

    function refreshHints() {
        const api = S.apis[config.engine];
        const keyMissing = !S.ui.hasKey(config.engine);
        const note = $('dict-key-missing');
        note.classList.toggle('hidden', !keyMissing);
        if (keyMissing) {
            note.replaceChildren(`Für ${api.label} fehlt noch der API-Key. `, el('button', { type: 'button', class: 'btn-text', text: 'API-Keys öffnen', onclick: () => S.app.switchView('keys') }));
        }
        $('dict-keys-hint').textContent = config.mode === 'hold'
            ? 'Leertaste oder Knopf gedrückt halten, solange du sprichst. Esc verwirft.'
            : 'Leertaste oder Knopf zum Starten und Beenden. Esc verwirft.';
    }

    // --- Operation: click / hold / space bar ---------------------------------------------------
    function onDown() {
        if (phase === 'idle') startRecording();
        else if (phase === 'recording' && config.mode === 'tap') stopRecording();
    }

    function onUp() {
        if (config.mode !== 'hold') return;
        if (phase === 'recording' || phase === 'starting') stopRecording();
    }

    function setupControls() {
        const main = $('dict-main');
        // Click or Enter in "Antippen"; "Halten" is handled by the pointer events.
        main.addEventListener('click', () => { if (config.mode === 'tap') onDown(); });
        main.addEventListener('pointerdown', e => {
            if (config.mode !== 'hold' || e.button > 0) return;
            main.setPointerCapture?.(e.pointerId);
            onDown();
        });
        ['pointerup', 'pointercancel'].forEach(type => main.addEventListener(type, () => onUp()));
        main.addEventListener('contextmenu', e => { if (config.mode === 'hold') e.preventDefault(); });
        $('dict-cancel').addEventListener('click', cancel);

        const isDictationKeyTarget = t => t === document.body || t === document.documentElement || t === main;
        document.addEventListener('keydown', e => {
            if (!viewVisible()) return;
            if (e.key === 'Escape' && phase !== 'idle') { e.preventDefault(); cancel(); return; }
            if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey || !isDictationKeyTarget(e.target)) return;
            e.preventDefault();
            if (!e.repeat) onDown();
        });
        document.addEventListener('keyup', e => {
            if (!viewVisible() || e.code !== 'Space' || !isDictationKeyTarget(e.target)) return;
            e.preventDefault();
            onUp();
        });
        window.addEventListener('beforeunload', e => {
            if (phase !== 'idle') { e.preventDefault(); e.returnValue = ''; }
        });
    }

    // --- Styles: chips, hint, manager ----------------------------------------------------------
    function renderStyleChips() {
        const styles = core.allStyles(customStyles);
        const chips = [{ id: core.RAW_STYLE_ID, name: 'Rohtext' }, ...styles].map(style =>
            el('button', {
                type: 'button', class: 'engine-chip', 'aria-pressed': String(style.id === config.style), text: style.name,
                onclick: () => { config.style = style.id; saveConfig(); renderStyleChips(); }
            }));
        $('dict-styles').replaceChildren(...chips);
        const current = core.findStyle(config.style, customStyles);
        $('dict-style-hint').textContent = current
            ? current.prompt
            : 'Nur das Transkript der Engine, ohne KI-Schritt. Ersetzungen gelten trotzdem.';

        const options = styles.map(s => el('option', { value: s.id, text: s.name }));
        const selected = $('dict-rerun-style').value;
        $('dict-rerun-style').replaceChildren(...options);
        if (selected && styles.some(s => s.id === selected)) $('dict-rerun-style').value = selected;
    }

    function renderStyleList() {
        const items = core.allStyles(customStyles).map(style => el('li', { class: 'dict-style-item' },
            el('div', { class: 'min-w-0' },
                el('p', { class: 'data-title', text: style.name + (style.custom ? '' : ' (eingebaut)') }),
                el('p', { class: 't-small muted dict-style-prompt', text: style.prompt })),
            el('div', { class: 'dict-style-actions' },
                el('button', { type: 'button', class: 'btn-text', text: style.custom ? 'Bearbeiten' : 'Als Vorlage', onclick: () => editStyle(style) }),
                style.custom ? el('button', { type: 'button', class: 'btn-text is-danger', text: 'Löschen', onclick: () => deleteStyle(style) }) : null)));
        $('dict-style-list').replaceChildren(...items);
    }

    function editStyle(style) {
        editingStyleId = style.custom ? style.id : null;
        $('dict-style-name').value = style.custom ? style.name : style.name + ' (Kopie)';
        $('dict-style-prompt').value = style.prompt;
        $('dict-style-form-title').textContent = style.custom ? 'Stil bearbeiten' : 'Neuer Stil nach Vorlage';
        $('dict-style-reset').classList.remove('hidden');
        $('dict-style-name').focus();
    }

    function resetStyleForm() {
        editingStyleId = null;
        $('dict-style-form').reset();
        $('dict-style-form-title').textContent = 'Neuer Stil';
        $('dict-style-reset').classList.add('hidden');
    }

    function saveStyle(e) {
        e.preventDefault();
        const name = $('dict-style-name').value.trim();
        const prompt = $('dict-style-prompt').value.trim();
        if (!name || !prompt) return S.ui.setStatus('Ein Stil braucht einen Namen und eine Anweisung.', 'error');
        if (editingStyleId) {
            customStyles = customStyles.map(s => s.id === editingStyleId ? { ...s, name, prompt } : s);
        } else {
            const id = core.newStyleId(customStyles);
            customStyles = [...customStyles, { id, name, prompt, custom: true }];
            config.style = id;
            saveConfig();
        }
        write(STYLES_KEY, customStyles);
        resetStyleForm();
        renderStyleChips();
        renderStyleList();
        S.ui.setStatus(`Stil „${name}“ gespeichert.`, 'success');
    }

    function deleteStyle(style) {
        if (!confirm(`Den Stil „${style.name}“ löschen?`)) return;
        customStyles = customStyles.filter(s => s.id !== style.id);
        write(STYLES_KEY, customStyles);
        if (config.style === style.id) { config.style = 'cleanup'; saveConfig(); }
        if (editingStyleId === style.id) resetStyleForm();
        renderStyleChips();
        renderStyleList();
    }

    // --- Settings card --------------------------------------------------------------------------
    function renderSettings() {
        $('dict-engine').replaceChildren(...Object.entries(S.apis).map(([id, api]) =>
            el('option', { value: id, text: shortLabel(api) + (S.ui.hasKey(id) ? '' : ' (kein Key)') })));
        $('dict-engine').value = config.engine;
        const api = S.apis[config.engine];
        $('dict-model').replaceChildren(...api.models.map(m => el('option', { value: m.id, text: m.name })));
        $('dict-model').value = config.model;
        $('dict-language').value = config.language;
        $('dict-language').disabled = !!api.autoLanguageOnly;
        $('dict-llm-provider').value = config.llmProvider;
        $('dict-llm-model').value = config.llmModel;
        $('dict-llm-model-list').replaceChildren(...S.summary.MODELS[config.llmProvider].map(id => el('option', { value: id })));
        $('dict-autocopy').checked = config.autoCopy;
        $('dict-mode').replaceChildren(...[['tap', 'Antippen'], ['hold', 'Halten']].map(([id, label]) =>
            el('button', {
                type: 'button', role: 'radio', 'aria-checked': String(config.mode === id), text: label,
                onclick: () => { config.mode = id; saveConfig(); renderSettings(); setPhase(phase); }
            })));
        const notes = [];
        if (!['elevenlabs', 'mistral'].includes(config.engine)) notes.push(`${shortLabel(api)} liefert das Ergebnis erst nach einigen Sekunden Wartezeit; ElevenLabs und Mistral sind für Diktate schneller.`);
        if (api.autoLanguageOnly) notes.push(`${shortLabel(api)} erkennt die Sprache automatisch.`);
        const vocab = api.vocabularySupport?.(config.model) ? S.vocabulary.describe(api.vocabularySupport(config.model)) : '';
        if (vocab) notes.push(vocab);
        $('dict-engine-note').textContent = notes.join(' ');
        $('dict-engine-note').classList.toggle('hidden', !notes.length);
    }

    function setupSettings() {
        $('dict-engine').addEventListener('change', e => {
            config.engine = e.target.value;
            config.model = S.apis[config.engine].models[0].id;
            saveConfig(); renderSettings(); refreshHints();
        });
        $('dict-model').addEventListener('change', e => { config.model = e.target.value; saveConfig(); renderSettings(); });
        $('dict-language').addEventListener('change', e => { config.language = e.target.value; saveConfig(); });
        $('dict-llm-provider').addEventListener('change', e => {
            config.llmProvider = e.target.value;
            config.llmModel = LLM_DEFAULTS[config.llmProvider];
            saveConfig(); renderSettings();
        });
        $('dict-llm-model').addEventListener('change', e => {
            config.llmModel = e.target.value.trim() || LLM_DEFAULTS[config.llmProvider];
            saveConfig(); renderSettings();
        });
        $('dict-autocopy').addEventListener('change', e => { config.autoCopy = e.target.checked; saveConfig(); });
    }

    // --- History --------------------------------------------------------------------------------
    function renderHistory() {
        $('dict-history-empty').classList.toggle('hidden', history.length > 0);
        $('dict-history-clear').classList.toggle('hidden', history.length === 0);
        const when = at => new Date(at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        $('dict-history').replaceChildren(...history.map(item => el('li', { class: 'dict-history-item' },
            el('div', { class: 'dict-history-head' },
                el('span', { class: 't-mono muted', text: `${when(item.at)} · ${item.styleName || 'Rohtext'} · ${core.wordCount(item.text)} Wörter` }),
                el('div', { class: 'dict-history-actions' },
                    el('button', { type: 'button', class: 'icon-btn is-small', 'aria-label': 'Kopieren', title: 'Kopieren', onclick: () => S.ui.copy(item.text) }, S.icon('copy')),
                    el('button', { type: 'button', class: 'icon-btn is-small', 'aria-label': 'Anzeigen', title: 'Oben anzeigen', onclick: () => openFromHistory(item) }, S.icon('eye')),
                    el('button', { type: 'button', class: 'icon-btn is-small', 'aria-label': 'Löschen', title: 'Löschen', onclick: () => removeFromHistory(item.id) }, S.icon('trash')))),
            el('p', { class: 'dict-history-text', text: item.text }))));
    }

    function openFromHistory(item) {
        showResult({
            source: item.raw || item.text, raw: item.raw || item.text, text: item.text,
            styleId: item.style, styleName: item.styleName || 'Rohtext', seconds: item.seconds, view: 'text'
        });
        $('dict-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function removeFromHistory(id) {
        history = core.removeFromHistory(history, id);
        write(HISTORY_KEY, history);
        renderHistory();
        S.settings?.refresh();
    }

    function clearHistory() {
        history = [];
        write(HISTORY_KEY, history);
        renderHistory();
    }

    // --- Replacements (shown on the "Fachbegriffe" page) -----------------------------------------
    function renderRules({ focusLast = false } = {}) {
        const save = () => { write(REPLACEMENTS_KEY, rules); $('repl-count').textContent = countLabel(); };
        const rows = rules.map((rule, index) => {
            const num = index + 1;
            const from = el('input', { class: 'input', value: rule.from, placeholder: 'aus', 'aria-label': `Regel ${num}: ersetze`, autocomplete: 'off', spellcheck: false });
            const to = el('input', { class: 'input', value: rule.to, placeholder: 'in (leer = löschen)', 'aria-label': `Regel ${num}: durch`, autocomplete: 'off', spellcheck: false });
            from.addEventListener('input', () => { rule.from = from.value; save(); });
            to.addEventListener('input', () => { rule.to = to.value; save(); });
            const whole = el('input', { type: 'checkbox', checked: rule.wholeWord });
            whole.addEventListener('change', () => { rule.wholeWord = whole.checked; save(); });
            const matchCase = el('input', { type: 'checkbox', checked: rule.matchCase });
            matchCase.addEventListener('change', () => { rule.matchCase = matchCase.checked; save(); });
            return el('div', { class: 'repl-row' },
                el('div', { class: 'repl-fields' }, from, el('span', { class: 'repl-arrow muted', 'aria-hidden': 'true', text: '→' }), to),
                el('div', { class: 'repl-options' },
                    el('label', { class: 'check' }, whole, 'Ganzes Wort'),
                    el('label', { class: 'check' }, matchCase, 'Groß/Klein beachten'),
                    el('button', {
                        type: 'button', class: 'icon-btn is-small', 'aria-label': `Regel ${num} löschen`, title: 'Löschen',
                        onclick: () => { rules.splice(index, 1); save(); renderRules(); }
                    }, S.icon('trash'))));
        });
        $('repl-list').replaceChildren(...(rows.length ? rows : [el('p', { class: 't-small muted', text: 'Noch keine Regeln.' })]));
        $('repl-count').textContent = countLabel();
        if (focusLast) $('repl-list').querySelector('.repl-row:last-child input')?.focus();
    }

    const countLabel = () => {
        const n = rules.filter(r => r.from.trim()).length;
        return `${n} Regel${n === 1 ? '' : 'n'}`;
    };

    // --- Public ---------------------------------------------------------------------------------
    function init() {
        loadAll();
        renderStyleChips();
        renderStyleList();
        renderSettings();
        renderHistory();
        renderRules();
        setupSettings();
        setupControls();
        setPhase('idle');

        $('dict-text').addEventListener('input', () => {
            if (!last) return;
            if (last.view === 'raw' && last.raw !== last.text) last.raw = $('dict-text').value;
            else last.text = $('dict-text').value;
            const words = core.wordCount($('dict-text').value);
            $('dict-meta').textContent = $('dict-meta').textContent.replace(/^\d+ Wort(e)?/, `${words} Wort${words === 1 ? '' : 'e'}`);
        });
        $('dict-copy').addEventListener('click', () => S.ui.copy($('dict-text').value));
        $('dict-rerun').addEventListener('click', rerun);
        $('dict-style-form').addEventListener('submit', saveStyle);
        $('dict-style-reset').addEventListener('click', resetStyleForm);
        $('dict-history-clear').addEventListener('click', () => {
            if (confirm('Den Verlauf der Diktate in diesem Browser löschen?')) clearHistory();
        });
        $('repl-add').addEventListener('click', () => {
            rules.push({ from: '', to: '', wholeWord: true, matchCase: false });
            renderRules({ focusLast: true });
        });
    }

    // Keys changed: engine list shows which engines have one.
    function refresh() {
        if (!$('dict-engine').options.length) return;
        renderSettings();
        refreshHints();
    }

    S.dictation = {
        init, refresh, isActive: () => phase !== 'idle',
        historyCount: () => history.length, clearHistory,
        getRules: () => rules.map(r => ({ ...r }))
    };
})(window.Unisono);

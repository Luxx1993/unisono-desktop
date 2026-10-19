/*
 * Page "Diktat": speak, the AI tidies the text, it lands in the clipboard.
 *
 * Flow: record (own light recorder, no on-site extras) → transcribe with the chosen engine
 * (Unisono.apis[…].transcribe, no speaker separation) → clean up with a style via Anthropic or OpenAI
 * (Unisono.summary.complete) → apply the find-and-replace rules → show, copy, keep in the history.
 *
 * Tasks:
 * - "Diktieren": the flow above.
 * - "Umformulieren": a text plus an instruction ("kürzer", "auf Englisch"), spoken or typed, becomes a new text.
 *
 * Long dictation: while recording in "Antippen" the recording is cut at pauses; each part is transcribed
 * while the user keeps talking, so the text is nearly there at the end (see dictationCore.shouldCut).
 *
 * Operation: "Antippen" (start and stop with a click or the space bar) or "Halten" (hold the button or
 * the space bar). The space bar works while this page is open and no text field has the focus.
 * Everything is stored in this browser: settings, own styles, replacement rules, statistics and the last
 * 50 dictations.
 *
 * The page also feeds the floating window (dictation-mini.js) through S.dictation.on(…) and the calls
 * down / up / cancel / setStyle / getState.
 *
 * The logic without a page (styles, prompts, rules, history, statistics) is in dictation-core.js.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const core = S.dictationCore;
    const $ = id => document.getElementById(id);

    const CONFIG_KEY = 'unisono_dictation';
    const STYLES_KEY = 'unisono_dictation_styles';
    const HISTORY_KEY = 'unisono_dictation_history';
    const REPLACEMENTS_KEY = 'unisono_replacements';
    const STATS_KEY = 'unisono_dictation_stats';

    const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    const BITRATE = 64000;
    const MIN_SECONDS = 0.7;          // shorter takes are accidents
    const TICK_MS = 100;
    const LLM_DEFAULTS = { anthropic: 'claude-haiku-5-5', openai: 'gpt-5-mini' };
    const MAX_TERMS_FOR_CLEANUP = 100;

    const config = {
        engine: null, model: null, language: 'de', mode: 'tap', task: 'dictate', longDictation: true,
        miniSkin: 'cloud', miniPalette: S.orbs.DEFAULT_PALETTE, miniDim: true,
        style: 'cleanup', llmProvider: 'anthropic', llmModel: LLM_DEFAULTS.anthropic, autoCopy: true
    };
    let customStyles = [];
    let history = [];
    let rules = [];
    let stats = core.emptyStats();

    let phase = 'idle';        // 'idle' | 'starting' | 'recording' | 'working'
    let rec = null;            // the running recording
    let pendingEnd = null;     // 'stop' | 'cancel': the key was let go (or Esc pressed) while the microphone was still opening
    let abortController = null;
    let last = null;           // { kind, source, raw, text, styleId, styleName, rawLabel, seconds, instruction, view: 'text' | 'raw' }
    let editingStyleId = null;
    let copyHost = null;       // window whose clipboard to use (the floating window while it has the focus)
    let lastLevel = 0;
    let lastSeconds = 0;

    // --- Events for the floating window ---
    const listeners = new Set();
    function on(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }
    function emit(type, data) {
        for (const fn of listeners) fn(type, data);
    }

    // Status line of the page, and the same message for the floating window.
    function say(text, type = 'info') {
        S.ui.setStatus(text, type);
        emit('notice', { text, type });
    }
    function sayError(prefix, err) {
        S.ui.showError(prefix, err);
        emit('notice', { text: `${prefix}: ${err.message}`, type: 'error' });
    }

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
        stats = core.sanitizeStats(read(STATS_KEY, null));
        if (!S.apis[config.engine]) config.engine = null;
        if (config.mode !== 'hold') config.mode = 'tap';
        if (config.task !== 'reword') config.task = 'dictate';
        config.longDictation = config.longDictation !== false;
        if (config.miniSkin !== 'wave') config.miniSkin = 'cloud';
        config.miniPalette = S.orbs.paletteById(config.miniPalette).id;
        config.miniDim = config.miniDim !== false;
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
    const shortLabel = api => api.label.split(' (')[0];

    function formatTime(seconds) {
        const s = Math.max(0, Math.floor(seconds));
        return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }

    // Compact duration: `3h 12m`, `12m`, `45s`.
    function formatDuration(totalSeconds) {
        const s = Math.max(0, Math.round(totalSeconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
        return m > 0 ? `${m}m` : `${s % 60}s`;
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

    const rewording = () => config.task === 'reword';

    async function startRecording() {
        if (phase !== 'idle') return;
        if (S.recorder.isActive()) {
            return say('Unter „Aufnahme“ läuft gerade eine Aufnahme. Bitte zuerst beenden.', 'error');
        }
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
            return say('Dieser Browser unterstützt keine Aufnahme über das Mikrofon.', 'error');
        }
        if (!S.ui.hasKey(config.engine)) {
            return say(`Bitte zuerst den API-Key für ${S.apis[config.engine].label} unter „API-Keys“ eintragen.`, 'error');
        }
        if (rewording()) {
            if (!$('dict-reword-source').value.trim()) return say('Bitte zuerst den Text eintragen, der umformuliert werden soll.', 'error');
            if (!S.ui.hasKey(config.llmProvider)) {
                return say(`Zum Umformulieren fehlt der API-Key für ${llmLabel()} unter „API-Keys“.`, 'error');
            }
        }
        pendingEnd = null;
        setPhase('starting');
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
        } catch (err) {
            setPhase('idle');
            return say(micMessage(err), 'error');
        }
        try {
            abortController = new AbortController();
            rec = openRecording(stream);
        } catch (err) {
            stream.getTracks().forEach(t => t.stop());
            abortController = null;
            setPhase('idle');
            return say('Die Aufnahme lässt sich nicht starten: ' + err.message, 'error');
        }
        setPhase('recording');
        if (pendingEnd === 'stop') stopRecording();
        else if (pendingEnd === 'cancel') cancel();
        pendingEnd = null;
    }

    const llmLabel = () => ({ anthropic: 'Anthropic (Claude)', openai: 'OpenAI' })[config.llmProvider];

    // One MediaRecorder per part of the recording; all of them listen to the same microphone stream.
    function startSegment(r) {
        const mime = r.mime;
        const recorder = new MediaRecorder(r.stream, mime ? { mimeType: mime, audioBitsPerSecond: BITRATE } : { audioBitsPerSecond: BITRATE });
        const seg = { recorder, chunks: [], startedAt: performance.now(), speech: false, silentSince: null };
        recorder.ondataavailable = e => { if (e.data.size) seg.chunks.push(e.data); };
        recorder.start(1000);
        r.segment = seg;
        return seg;
    }

    // Stops a part; resolves with its audio.
    function endSegment(seg, mime) {
        return new Promise(resolve => {
            const seconds = (performance.now() - seg.startedAt) / 1000;
            const done = () => resolve({ blob: new Blob(seg.chunks, { type: mime }), seconds, hadSpeech: seg.speech });
            if (seg.recorder.state === 'inactive') return done();
            seg.recorder.onstop = done;
            seg.recorder.stop();
        });
    }

    function openRecording(stream) {
        const r = {
            stream, mime: pickMimeType(), startedAt: performance.now(), timer: null, ctx: null, analyser: null, data: null,
            segment: null, parts: [], done: 0,
            // Long dictation runs only while tapping: when holding, the part is as long as the key is down anyway.
            longOk: config.longDictation && config.mode === 'tap' && !rewording()
        };
        startSegment(r);
        r.mime = r.segment.recorder.mimeType || r.mime;

        try {
            r.ctx = new (window.AudioContext || window.webkitAudioContext)();
            r.analyser = r.ctx.createAnalyser();
            r.analyser.fftSize = 512;
            r.ctx.createMediaStreamSource(stream).connect(r.analyser);
            r.data = new Uint8Array(r.analyser.fftSize);
        } catch (_) {}

        // A timer rather than requestAnimationFrame: a tab in the background (or a floating window in front
        // of it) gets no animation frames, but the recording has to go on.
        r.timer = setInterval(() => tick(r), TICK_MS);
        return r;
    }

    function readLevel(r) {
        if (!r.analyser) return 0;
        r.analyser.getByteTimeDomainData(r.data);
        let sum = 0;
        for (const v of r.data) sum += ((v - 128) / 128) ** 2;
        return Math.sqrt(sum / r.data.length);
    }

    function tick(r) {
        if (rec !== r) return;
        const now = performance.now();
        lastSeconds = (now - r.startedAt) / 1000;
        lastLevel = readLevel(r);
        $('dict-time').textContent = formatTime(lastSeconds);
        $('dict-level').style.transform = `scaleX(${Math.min(1, lastLevel * 4).toFixed(3)})`;

        const seg = r.segment;
        if (seg) {
            if (lastLevel > core.CHUNK.speechLevel) { seg.speech = true; seg.silentSince = null; }
            else if (seg.speech && seg.silentSince == null) seg.silentSince = now;
            if (r.longOk && core.shouldCut({
                chunkSeconds: (now - seg.startedAt) / 1000,
                silenceSeconds: seg.silentSince == null ? 0 : (now - seg.silentSince) / 1000,
                hadSpeech: seg.speech
            })) cutSegment(r);
        }
        emit('tick', { seconds: lastSeconds, level: lastLevel, parts: r.parts.length, done: r.done });
        if (r.parts.length) $('dict-state').textContent = stateText();
    }

    // The next part starts at once; the finished one is transcribed in the background.
    function cutSegment(r) {
        const old = r.segment;
        startSegment(r);
        endSegment(old, r.mime).then(audio => queuePart(r, audio));
    }

    function queuePart(r, audio) {
        if (audio.seconds < MIN_SECONDS || audio.blob.size < 1000 || !audio.hadSpeech) return;
        const promise = transcribeAudio(audio.blob, r.mime, abortController.signal).then(text => {
            r.done += 1;
            return text;
        });
        promise.catch(() => {});   // a failing part is reported when the recording ends
        r.parts.push(promise);
    }

    function closeRecording(r) {
        clearInterval(r.timer);
        r.stream.getTracks().forEach(t => t.stop());
        r.ctx?.close().catch(() => {});
        $('dict-level').style.transform = 'scaleX(0)';
        $('dict-time').textContent = '00:00';
    }

    async function stopRecording() {
        if (phase === 'starting') { pendingEnd = 'stop'; return; }
        if (phase !== 'recording') return;
        const r = rec;
        rec = null;
        const seconds = (performance.now() - r.startedAt) / 1000;
        const audio = await endSegment(r.segment, r.mime);
        closeRecording(r);
        r.segment = null;
        if (seconds < MIN_SECONDS || (!r.parts.length && audio.blob.size < 1000)) {
            r.parts.length = 0;
            abortController?.abort();
            abortController = null;
            setPhase('idle');
            return say(config.mode === 'hold'
                ? 'Zu kurz. Zum Diktieren die Taste gedrückt halten, solange du sprichst.'
                : 'Zu kurz, es wurde nichts aufgenommen.', 'note');
        }
        setPhase('working');
        try {
            // The last part counts even when no speech was heard in it, if it is all there is: a quiet microphone.
            queuePart(r, { ...audio, hadSpeech: audio.hadSpeech || r.parts.length === 0 });
            await finishTake(r, seconds);
        } catch (err) {
            if (err.name === 'AbortError') say('Diktat abgebrochen.', 'note');
            else { sayError(rewording() ? 'Umformulieren fehlgeschlagen' : 'Diktat fehlgeschlagen', err); emit('done', { ok: false }); }
        } finally {
            abortController = null;
            setPhase('idle');
        }
    }

    async function cancel() {
        if (phase === 'starting') { pendingEnd = 'cancel'; return; }
        if (phase === 'recording') {
            const r = rec;
            rec = null;
            abortController?.abort();
            abortController = null;
            await endSegment(r.segment, r.mime);
            closeRecording(r);
            setPhase('idle');
            say('Diktat verworfen.', 'note');
        } else if (phase === 'working') {
            abortController?.abort();
        }
    }

    // --- Transcribe, clean up, deliver -------------------------------------------------------------
    // Audio → text with the chosen engine. One retry for a hiccup; a cancel is never retried.
    async function transcribeAudio(blob, mime, signal) {
        const api = S.apis[config.engine];
        const key = S.ui.getKey(config.engine);
        const file = new File([blob], `diktat.${extensionFor(mime)}`, { type: mime });
        const support = api.vocabularySupport?.(config.model);
        const vocabulary = support ? S.vocabulary.prepare(S.vocabulary.getTerms(), support).terms : [];
        const options = {
            key, model: config.model, language: config.language, diarize: false, speakers: null,
            vocabulary, signal, onStage: () => {}, onUpload: () => {}
        };
        for (let attempt = 0; ; attempt++) {
            try {
                const result = await api.transcribe(file, options);
                return core.joinSegments(result.segments);
            } catch (err) {
                if (err.name === 'AbortError' || attempt >= 1) throw err;
                await new Promise(resolve => setTimeout(resolve, 1200));
            }
        }
    }

    // All parts of a recording → text → dictation or instruction.
    async function finishTake(r, seconds) {
        const api = S.apis[config.engine];
        say(`Transkribiere mit ${shortLabel(api)} …`);
        const texts = await Promise.all(r.parts);
        const source = core.joinChunkTexts(texts);
        if (!source) {
            return say('Es wurde nichts erkannt. Bitte lauter oder näher am Mikrofon sprechen.', 'note');
        }
        if (rewording()) {
            $('dict-reword-instruction').value = source;
            return runReword(source, abortController.signal);
        }
        await deliver(source, seconds, config.style, abortController.signal);
    }

    // The raw text → the finished text of a style (on failure: the raw text, with the reason in the status line).
    async function tidy(source, styleId, signal) {
        const style = styleId === core.RAW_STYLE_ID ? null : core.findStyle(styleId, customStyles);
        if (!style) return { text: source, styleName: 'Rohtext', failed: false };
        say(`Räume auf (${style.name}) mit ${config.llmModel} …`);
        try {
            const key = S.ui.getKey(config.llmProvider);
            const terms = S.vocabulary.getTerms().slice(0, MAX_TERMS_FOR_CLEANUP);
            const answer = await S.summary.complete({
                provider: config.llmProvider, key, model: config.llmModel,
                system: core.buildSystemPrompt(style.prompt, terms),
                user: core.buildUserMessage(source)
            });
            if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
            countRewording();
            return { text: core.cleanModelOutput(answer) || source, styleName: style.name, failed: false };
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            sayError('Aufräumen nicht möglich, der Rohtext steht bereit', err);
            return { text: source, styleName: 'Rohtext', failed: true, error: err };
        }
    }

    async function deliver(source, seconds, styleId, signal) {
        const tidied = await tidy(source, styleId, signal);
        const entry = {
            kind: 'dictation',
            source,
            raw: core.applyReplacements(source, rules),
            text: core.applyReplacements(tidied.text, rules),
            styleId: tidied.failed ? core.RAW_STYLE_ID : styleId,
            styleName: tidied.styleName,
            rawLabel: 'Rohtext',
            instruction: '',
            seconds,
            view: 'text'
        };
        await finish(entry, tidied.failed);
    }

    // Shows, remembers and copies a finished entry.
    async function finish(entry, failed = false) {
        showResult(entry);
        remember(entry);
        if (entry.kind === 'dictation') {
            stats = core.recordDictation(stats, entry.text, entry.seconds, core.epochDay());
            saveStats();
        }
        // A failed clean-up keeps its message in the status line; the copy then happens without a note.
        const copied = config.autoCopy && await copyQuietly(entry.text);
        emit('done', { ok: !failed });
        if (failed) return;
        if (!config.autoCopy) say('Fertig.', 'success');
        else if (copied) say('Fertig. Der Text liegt in der Zwischenablage.', 'success');
        else say('Fertig. Der Browser hat das automatische Kopieren blockiert, bitte „Kopieren“ klicken.', 'note');
    }

    // In the floating window the page behind is not focused, and an unfocused page may not use the clipboard.
    async function copyQuietly(text) {
        const windows = [copyHost, window].filter(Boolean);
        for (const win of windows) {
            try {
                await win.navigator.clipboard.writeText(text);
                return true;
            } catch (_) {}
        }
        return false;
    }

    function countRewording() {
        stats = core.recordRewording(stats);
        saveStats();
    }

    function remember(entry) {
        history = core.addToHistory(history, {
            id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            at: Date.now(),
            style: entry.styleId,
            styleName: entry.styleName,
            raw: entry.raw,
            text: entry.text,
            seconds: Math.round(entry.seconds),
            kind: entry.kind,
            instruction: entry.instruction
        });
        write(HISTORY_KEY, history);
        renderHistory();
        S.settings?.refresh();
    }

    function saveStats() {
        write(STATS_KEY, stats);
        renderStats();
        S.settings?.refresh();
    }

    // --- Rewording ---------------------------------------------------------------------------------
    async function runReword(instruction, signal) {
        const text = $('dict-reword-source').value.trim();
        instruction = String(instruction || '').trim();
        if (!text) return say('Bitte zuerst den Text eintragen, der umformuliert werden soll.', 'error');
        if (!instruction) return say('Bitte eine Anweisung sprechen oder eintippen, etwa „kürzer“.', 'error');
        say(`Formuliere um mit ${config.llmModel} …`);
        const key = S.ui.getKey(config.llmProvider);
        const answer = await S.summary.complete({
            provider: config.llmProvider, key, model: config.llmModel,
            system: core.buildRewordSystem(S.vocabulary.getTerms().slice(0, MAX_TERMS_FOR_CLEANUP)),
            user: core.buildRewordUser(text, instruction)
        });
        if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
        countRewording();
        const result = core.cleanModelOutput(answer);
        if (!result) throw new Error('Die KI hat keinen Text geliefert.');
        await finish({
            kind: 'reword', source: text, raw: text,
            text: core.applyReplacements(result, rules),
            styleId: 'reword', styleName: 'Umformuliert', rawLabel: 'Vorher',
            instruction, seconds: 0, view: 'text'
        });
    }

    // The button / Enter in the instruction field: the instruction is typed.
    async function rewordTyped(instruction) {
        if (phase !== 'idle') return;
        if (!S.ui.hasKey(config.llmProvider)) {
            return say(`Zum Umformulieren fehlt der API-Key für ${llmLabel()} unter „API-Keys“.`, 'error');
        }
        $('dict-reword-instruction').value = instruction;
        setPhase('working');
        abortController = new AbortController();
        try {
            await runReword(instruction, abortController.signal);
        } catch (err) {
            if (err.name === 'AbortError') say('Abgebrochen.', 'note');
            else { sayError('Umformulieren fehlgeschlagen', err); emit('done', { ok: false }); }
        } finally {
            abortController = null;
            setPhase('idle');
        }
    }

    function setTask(task) {
        if (phase !== 'idle' || (task !== 'dictate' && task !== 'reword')) return;
        config.task = task;
        saveConfig();
        renderTask();
        setPhase(phase);
        emit('task', getState());
    }

    function renderTask() {
        const reword = rewording();
        $('dict-reword').classList.toggle('hidden', !reword);
        $('dict-style-field').classList.toggle('hidden', reword);
        $('dict-task').replaceChildren(...[['dictate', 'Diktieren'], ['reword', 'Umformulieren']].map(([id, label]) =>
            el('button', {
                type: 'button', role: 'radio', 'aria-checked': String(config.task === id), text: label,
                onclick: () => setTask(id)
            })));
        $('dict-reword-chips').replaceChildren(...core.REWORD_SUGGESTIONS.map(text =>
            el('button', { type: 'button', class: 'engine-chip', text, onclick: () => rewordTyped(text) })));
    }

    function setupReword() {
        $('dict-reword-run').addEventListener('click', () => rewordTyped($('dict-reword-instruction').value));
        $('dict-reword-instruction').addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); rewordTyped($('dict-reword-instruction').value); }
        });
        $('dict-reword-paste').addEventListener('click', async () => {
            try {
                $('dict-reword-source').value = await navigator.clipboard.readText();
            } catch (_) {
                say('Der Browser erlaubt das Einfügen nicht. Bitte den Text im Feld mit Strg+V einfügen.', 'error');
            }
        });
        $('dict-reword-use').addEventListener('click', () => {
            if (!last) return say('Es gibt noch kein Ergebnis zum Übernehmen.', 'note');
            $('dict-reword-source').value = $('dict-text').value;
        });
    }

    // --- Result card ---------------------------------------------------------------------------
    function showResult(entry) {
        last = entry;
        $('dict-result').classList.remove('hidden');
        renderResult();
        emit('result', currentResult());
    }

    function renderResult() {
        if (!last) return;
        const differs = last.raw !== last.text;
        const view = differs ? last.view : 'text';
        $('dict-text').value = view === 'raw' ? last.raw : last.text;
        const toggle = $('dict-view');
        toggle.classList.toggle('hidden', !differs);
        toggle.replaceChildren(...[['text', last.styleName], ['raw', last.rawLabel]].map(([id, label]) =>
            el('button', {
                type: 'button', role: 'radio', 'aria-checked': String(id === view), text: label,
                onclick: () => { last.view = id; renderResult(); emit('result', currentResult()); }
            })));
        const words = core.wordCount($('dict-text').value);
        $('dict-meta').textContent = [
            `${words} Wort${words === 1 ? '' : 'e'}`,
            last.seconds ? formatTime(last.seconds) : null,
            view === 'raw' ? last.rawLabel : last.styleName,
            last.kind === 'reword' && last.instruction ? `„${last.instruction}“` : null
        ].filter(Boolean).join(' · ');
        $('dict-rerun-wrap').classList.toggle('hidden', last.kind === 'reword');
        $('dict-rerun-style').value = last.styleId === core.RAW_STYLE_ID ? config.style : last.styleId;
    }

    const currentResult = () => last ? { text: $('dict-text').value, kind: last.kind, label: last.styleName } : null;

    async function rerun() {
        if (!last || phase !== 'idle' || last.kind === 'reword') return;
        const styleId = $('dict-rerun-style').value;
        setPhase('working');
        abortController = new AbortController();
        try {
            await deliver(last.source, last.seconds, styleId, abortController.signal);
        } catch (err) {
            if (err.name === 'AbortError') say('Abgebrochen.', 'note');
            else { sayError('Aufräumen fehlgeschlagen', err); emit('done', { ok: false }); }
        } finally {
            abortController = null;
            setPhase('idle');
        }
    }

    // --- Phase → UI ---------------------------------------------------------------------------
    function stateText() {
        if (phase === 'recording') {
            const n = rec?.parts.length || 0;
            return n ? `Aufnahme läuft · ${rec.done} von ${n} Teil${n === 1 ? '' : 'en'} transkribiert` : 'Aufnahme läuft';
        }
        return { starting: 'Mikrofon wird geöffnet …', working: 'Wird verarbeitet …' }[phase] || 'Bereit';
    }

    function mainButtonText() {
        const hold = config.mode === 'hold';
        if (phase === 'working') return 'Einen Moment …';
        if (phase === 'recording') return hold ? 'Loslassen zum Beenden' : 'Stoppen';
        if (rewording()) return hold ? 'Zum Sprechen der Anweisung halten' : 'Anweisung sprechen';
        return hold ? 'Zum Diktieren halten' : 'Diktat starten';
    }

    function setPhase(next) {
        phase = next;
        const recording = phase === 'recording';
        const busy = phase === 'working';
        $('dict-recorder').classList.toggle('is-recording', recording);
        document.documentElement.classList.toggle('is-dictating', recording || phase === 'starting');
        $('dict-state').textContent = stateText();
        const button = $('dict-main');
        button.disabled = busy;
        $('dict-main-text').textContent = mainButtonText();
        S.setIcon(button.querySelector('.icon'), recording ? 'stop' : 'mic');
        $('dict-cancel').classList.toggle('is-invisible', phase === 'idle' || phase === 'starting');
        $('dict-cancel').textContent = busy ? 'Abbrechen' : 'Verwerfen';
        $('dict-rerun').disabled = phase !== 'idle';
        $('dict-reword-run').disabled = phase !== 'idle';
        refreshHints();
        emit('phase', getState());
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

    function styleNameOf(id) {
        return id === core.RAW_STYLE_ID ? 'Rohtext' : core.findStyle(id, customStyles)?.name || 'Aufräumen';
    }

    function getState() {
        return {
            phase, task: config.task, mode: config.mode, style: config.style,
            styles: [{ id: core.RAW_STYLE_ID, name: 'Rohtext' }, ...core.allStyles(customStyles).map(s => ({ id: s.id, name: s.name }))],
            stateText: stateText(), seconds: lastSeconds, level: lastLevel,
            buttonText: mainButtonText(), result: currentResult(), hint: $('dict-keys-hint').textContent,
            skin: config.miniSkin, palette: config.miniPalette, dim: config.miniDim,
            suggestions: core.REWORD_SUGGESTIONS, styleName: styleNameOf(config.style)
        };
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

    // Shared by the page and the floating window; [isTarget] says which focus targets may use the space bar.
    function keyDown(e, isTarget) {
        if (e.key === 'Escape' && phase !== 'idle') { e.preventDefault(); cancel(); return true; }
        if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey || !isTarget(e.target)) return false;
        e.preventDefault();
        if (!e.repeat) onDown();
        return true;
    }

    function keyUp(e, isTarget) {
        if (e.code !== 'Space' || !isTarget(e.target)) return false;
        e.preventDefault();
        onUp();
        return true;
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

        const isTarget = t => t === document.body || t === document.documentElement || t === main;
        document.addEventListener('keydown', e => { if (viewVisible()) keyDown(e, isTarget); });
        document.addEventListener('keyup', e => { if (viewVisible()) keyUp(e, isTarget); });
        window.addEventListener('beforeunload', e => {
            if (phase !== 'idle') { e.preventDefault(); e.returnValue = ''; }
        });
    }

    function setStyle(id) {
        if (id !== core.RAW_STYLE_ID && !core.findStyle(id, customStyles)) return;
        config.style = id;
        saveConfig();
        renderStyleChips();
    }

    // --- Styles: chips, hint, manager ----------------------------------------------------------
    function renderStyleChips() {
        const styles = core.allStyles(customStyles);
        const chips = [{ id: core.RAW_STYLE_ID, name: 'Rohtext' }, ...styles].map(style =>
            el('button', {
                type: 'button', class: 'engine-chip', 'aria-pressed': String(style.id === config.style), text: style.name,
                onclick: () => setStyle(style.id)
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
        emit('style', getState());
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
        if (!name || !prompt) return say('Ein Stil braucht einen Namen und eine Anweisung.', 'error');
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
        say(`Stil „${name}“ gespeichert.`, 'success');
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
        $('dict-longdictation').checked = config.longDictation;
        $('dict-mini-skin').value = config.miniSkin;
        $('dict-mini-dim').checked = config.miniDim;
        $('dict-mini-palette-field').classList.toggle('hidden', config.miniSkin !== 'cloud');
        $('dict-mini-palette').replaceChildren(...S.orbs.PALETTES.map(p =>
            el('button', {
                type: 'button', class: 'palette-dot', role: 'radio', 'aria-checked': String(p.id === config.miniPalette),
                'aria-label': p.name, title: p.name, style: `background: ${S.orbs.surfaceGradient(p.id)}`,
                onclick: () => { config.miniPalette = p.id; saveConfig(); renderSettings(); emit('config', getState()); }
            })));
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
        $('dict-longdictation').addEventListener('change', e => { config.longDictation = e.target.checked; saveConfig(); });
        $('dict-mini-skin').addEventListener('change', e => { config.miniSkin = e.target.value; saveConfig(); renderSettings(); emit('config', getState()); });
        $('dict-mini-dim').addEventListener('change', e => { config.miniDim = e.target.checked; saveConfig(); emit('config', getState()); });
    }

    // --- History --------------------------------------------------------------------------------
    function renderHistory() {
        $('dict-history-empty').classList.toggle('hidden', history.length > 0);
        $('dict-history-clear').classList.toggle('hidden', history.length === 0);
        const when = at => new Date(at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        $('dict-history').replaceChildren(...history.map(item => el('li', { class: 'dict-history-item' },
            el('div', { class: 'dict-history-head' },
                el('span', { class: 't-mono muted', text: `${when(item.at)} · ${item.kind === 'reword' ? 'Umformuliert' : item.styleName || 'Rohtext'} · ${core.wordCount(item.text)} Wörter` }),
                el('div', { class: 'dict-history-actions' },
                    el('button', { type: 'button', class: 'icon-btn is-small', 'aria-label': 'Kopieren', title: 'Kopieren', onclick: () => S.ui.copy(item.text) }, S.icon('copy')),
                    el('button', { type: 'button', class: 'icon-btn is-small', 'aria-label': 'Anzeigen', title: 'Oben anzeigen', onclick: () => openFromHistory(item) }, S.icon('eye')),
                    el('button', { type: 'button', class: 'icon-btn is-small', 'aria-label': 'Löschen', title: 'Löschen', onclick: () => removeFromHistory(item.id) }, S.icon('trash')))),
            item.kind === 'reword' && item.instruction ? el('p', { class: 't-small muted', text: `Anweisung: ${item.instruction}` }) : null,
            el('p', { class: 'dict-history-text', text: item.text }))));
    }

    function openFromHistory(item) {
        const reword = item.kind === 'reword';
        showResult({
            kind: item.kind, source: item.raw || item.text, raw: item.raw || item.text, text: item.text,
            styleId: item.style, styleName: reword ? 'Umformuliert' : item.styleName || 'Rohtext',
            rawLabel: reword ? 'Vorher' : 'Rohtext', instruction: item.instruction, seconds: item.seconds, view: 'text'
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

    // --- Statistics -------------------------------------------------------------------------------
    function renderStats() {
        const body = $('dict-stats');
        const empty = !stats.dictations && !stats.rewordings;
        $('dict-stats-reset').classList.toggle('hidden', empty && !stats.firstUse);
        if (empty) {
            body.replaceChildren(el('p', { class: 't-small muted', text: 'Noch keine Diktate gezählt. Hier stehen später deine Wörter, die gesparte Zeit und die letzten sieben Tage.' }));
            return;
        }
        const saved = core.savedSeconds(stats.words, stats.spokenSeconds);
        const avg = stats.dictations ? stats.words / stats.dictations : 0;
        const pace = stats.spokenSeconds ? stats.words / (stats.spokenSeconds / 60) : 0;
        const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
        const streak = core.currentStreak(stats);
        const cards = [
            ['Diktate', nf.format(stats.dictations)],
            ['Wörter', nf.format(stats.words)],
            ['Gesprochen', formatDuration(stats.spokenSeconds)],
            ['Ø Wörter je Diktat', nf.format(avg)],
            ['Tempo', `${nf.format(pace)} Wörter/min`],
            ['Zeichen', nf.format(stats.chars)],
            ['Umformulierungen', nf.format(stats.rewordings)],
            ['Serie', `${streak} Tag${streak === 1 ? '' : 'e'}`, `Beste: ${stats.streakBest}`],
            ['Diesen Monat', `${nf.format(core.wordsThisMonth(stats))} Wörter`]
        ];
        const week = core.activity(stats);
        const max = Math.max(1, ...week.map(d => d.words));
        body.replaceChildren(
            el('div', { class: 'stat-hero' },
                el('span', { class: 't-label muted', text: 'Gesparte Zeit' }),
                el('span', { class: 'stat-hero-value', text: formatDuration(saved) }),
                el('span', { class: 't-small muted', text: `gegenüber dem Tippen mit ${core.TYPING_WPM} Wörtern pro Minute` })),
            el('div', { class: 'stat-grid' }, ...cards.map(([label, value, extra]) =>
                el('div', { class: 'stat-card' },
                    el('span', { class: 't-label muted', text: label }),
                    el('span', { class: 'stat-value' }, value, extra ? el('span', { class: 't-mono muted stat-extra', text: extra }) : null)))),
            el('div', { class: 'stat-week', 'aria-label': 'Wörter der letzten sieben Tage' },
                ...week.map(d => el('div', { class: 'stat-day', title: `${d.words} Wörter` },
                    el('span', { class: 'stat-bar' + (d.words ? ' has-words' : ''), style: `height: ${d.words ? Math.max(8, Math.round(d.words / max * 64)) : 3}px` }),
                    el('span', { class: 't-mono muted', text: new Date(d.day * 86400000).toLocaleDateString('de-DE', { weekday: 'narrow', timeZone: 'UTC' }) })))));
    }

    function clearStats() {
        stats = core.emptyStats();
        write(STATS_KEY, stats);
        renderStats();
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
        renderStats();
        renderTask();
        setupSettings();
        setupControls();
        setupReword();
        setPhase('idle');

        $('dict-text').addEventListener('input', () => {
            if (!last) return;
            if (last.view === 'raw' && last.raw !== last.text) last.raw = $('dict-text').value;
            else last.text = $('dict-text').value;
            const words = core.wordCount($('dict-text').value);
            $('dict-meta').textContent = $('dict-meta').textContent.replace(/^\d+ Wort(e)?/, `${words} Wort${words === 1 ? '' : 'e'}`);
            emit('result', currentResult());
        });
        $('dict-copy').addEventListener('click', () => S.ui.copy($('dict-text').value));
        $('dict-rerun').addEventListener('click', rerun);
        $('dict-style-form').addEventListener('submit', saveStyle);
        $('dict-style-reset').addEventListener('click', resetStyleForm);
        $('dict-history-clear').addEventListener('click', () => {
            if (confirm('Den Verlauf der Diktate in diesem Browser löschen?')) clearHistory();
        });
        $('dict-stats-reset').addEventListener('click', () => {
            if (confirm('Die Statistik der Diktate zurücksetzen?')) clearStats();
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
        statsCount: () => stats.dictations + stats.rewordings, clearStats,
        getRules: () => rules.map(r => ({ ...r })),
        // For the floating window
        on, getState, down: onDown, up: onUp, cancel, setStyle, setTask, keyDown, keyUp,
        reword: rewordTyped,
        setCopyHost: win => { copyHost = win; },
        editResult: text => { $('dict-text').value = text; $('dict-text').dispatchEvent(new Event('input')); }
    };
})(window.Unisono);

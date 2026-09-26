/*
 * App wiring: views, provider cards, API keys (with test ping), file handling,
 * transcription run, status line, transcript header and export menu.
 */
window.Scribe = window.Scribe || {};
(function (S) {
    const $ = id => document.getElementById(id);

    const MB = 1024 * 1024;
    const HTML_AUDIO_WARN_BYTES = 25 * MB;
    const KEY_PREFIX = 'scribe_key_';

    // Keys for the AI summary; the transcription providers come from S.apis.
    const LLM_KEYS = {
        anthropic: {
            label: 'Anthropic (Claude)',
            description: 'Für Zusammenfassungen, Stichpunkte und Protokolle.',
            icon: 'auto_awesome',
            keyUrl: 'https://console.anthropic.com/settings/keys',
            test: key => ({
                url: 'https://api.anthropic.com/v1/models',
                headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
            })
        },
        openai: {
            label: 'OpenAI',
            description: 'Alternative für Zusammenfassungen.',
            icon: 'psychology',
            keyUrl: 'https://platform.openai.com/api-keys',
            test: key => ({ url: 'https://api.openai.com/v1/models', headers: { 'Authorization': 'Bearer ' + key } })
        }
    };

    let currentFile = null;
    let currentDuration = null;  // seconds, once the player has read the file
    let selectedProvider = null;
    let statusTimer = null;

    // --- Small DOM helper: h('div', { class: 'x', text: 'y' }, child, …) ---
    function h(tag, props = {}, ...children) {
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

    const icon = (name, cls = '') => h('span', { class: `material-symbols-outlined ${cls}`, 'aria-hidden': 'true', text: name });

    // --- Status line (shared with the other modules via S.ui) ---
    function setStatus(text, type = 'info') {
        const icons = { info: 'progress_activity', success: 'check_circle', error: 'error' };
        clearTimeout(statusTimer);
        $('status-banner').className = 'status-banner status-' + type;
        $('status-icon').textContent = icons[type];
        $('status-text').textContent = text;
        if (type === 'success') statusTimer = setTimeout(hideStatus, 8000);
    }

    // Switching views dismisses a success note that belongs to the previous view.
    function hideStatusIfSuccess() {
        if ($('status-banner').classList.contains('status-success')) hideStatus();
    }

    function hideStatus() {
        $('status-banner').classList.add('hidden');
    }

    function showError(prefix, err) {
        const hint = err instanceof TypeError ? ' (Netzwerk- oder CORS-Fehler)' : '';
        setStatus(`${prefix}: ${err.message}${hint}`, 'error');
    }

    async function copy(text) {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setStatus('In die Zwischenablage kopiert.', 'success');
        } catch (_) {
            setStatus('Kopieren wurde vom Browser blockiert.', 'error');
        }
    }

    // --- Views ---
    function switchView(name) {
        document.querySelectorAll('.view').forEach(view => {
            const show = view.id === 'view-' + name;
            view.classList.toggle('hidden', !show);
            if (show) {
                // Restart the entrance animation.
                view.classList.remove('page-entrance');
                void view.offsetWidth;
                view.classList.add('page-entrance');
            }
        });
        document.querySelectorAll('.nav-item').forEach(item => {
            const current = item.dataset.view === name;
            item.classList.toggle('is-current', current);
            item.setAttribute('aria-current', current ? 'page' : 'false');
        });
        window.scrollTo({ top: 0 });
        hideStatusIfSuccess();
    }

    // --- Keys (localStorage may be unavailable, e.g. in private mode) ---
    const keys = {};

    function allKeyIds() {
        return [...Object.keys(S.apis), ...Object.keys(LLM_KEYS)];
    }

    function keyMeta(id) {
        return S.apis[id] || LLM_KEYS[id];
    }

    function loadKeys() {
        for (const id of allKeyIds()) {
            try { keys[id] = localStorage.getItem(KEY_PREFIX + id) || ''; } catch (_) { keys[id] = ''; }
        }
        // Deepgram was removed; don't keep its key around.
        try {
            localStorage.removeItem(KEY_PREFIX + 'deepgram');
            localStorage.removeItem(KEY_PREFIX + 'deepgram_proxy');
        } catch (_) {}
    }

    function storeKey(id, value) {
        keys[id] = value.trim();
        try {
            if (keys[id]) localStorage.setItem(KEY_PREFIX + id, keys[id]);
            else localStorage.removeItem(KEY_PREFIX + id);
            return true;
        } catch (_) {
            return false;
        }
    }

    function getKey(id) {
        if (!keys[id]) throw new Error(`Bitte zuerst den API-Key für ${keyMeta(id).label} unter „API-Einstellungen“ eintragen.`);
        return keys[id];
    }

    function keysChanged() {
        renderKeyStatus();
        renderProviderCards();
        updateHint();
    }

    function renderKeyStatus() {
        const items = Object.entries(S.apis).flatMap(([id, api], i) => [
            i ? h('span', { class: 'text-outline-variant', text: '|' }) : null,
            h('span', { class: 'key-status-item ' + (keys[id] ? 'is-set' : 'is-unset'), title: keys[id] ? 'Key hinterlegt' : 'Kein Key' },
                h('span', { class: 'dot' }), api.label.split(' ')[0])
        ]);
        $('key-status').replaceChildren(...items.filter(Boolean));
    }

    function renderKeyCards() {
        const card = id => {
            const meta = keyMeta(id);
            const inputId = 'key-' + id;
            const input = h('input', { id: inputId, type: 'password', class: 'field', autocomplete: 'off', spellcheck: false, placeholder: 'Key eingeben', value: keys[id] });
            const badge = h('span', { class: 'key-badge' });
            const feedback = h('div', { class: 'key-feedback hidden', 'aria-live': 'polite' });
            const setBadge = (state, text) => {
                badge.className = 'key-badge' + (state ? ' is-' + state : '');
                badge.replaceChildren(h('span', { class: 'dot' }), text);
            };
            const showFeedback = (state, text) => {
                feedback.className = 'key-feedback is-' + state;
                feedback.replaceChildren(icon(state === 'ok' ? 'check_circle' : state === 'error' ? 'error' : 'info', 'text-[16px] shrink-0'), h('span', { text }));
            };
            const refreshBadge = () => (keys[id] ? setBadge('saved', 'Gespeichert') : setBadge(null, 'Nicht gespeichert'));
            refreshBadge();

            // Saving on 'change' stays silent: a message appearing on blur would shift the
            // buttons below, so a click on "Test-Ping" right after typing would miss.
            const save = ({ quiet = false } = {}) => {
                const persisted = storeKey(id, input.value);
                refreshBadge();
                keysChanged();
                if (!persisted) showFeedback('error', 'Der Browser blockiert das Speichern. Der Key gilt nur bis zum Schließen der Seite.');
                else if (!quiet) showFeedback('info', keys[id] ? 'Key gespeichert.' : 'Key entfernt.');
            };
            input.addEventListener('change', () => save({ quiet: true }));

            const mask = h('button', { type: 'button', class: 'icon-btn', title: 'Anzeigen / verbergen', onclick: () => {
                input.type = input.type === 'password' ? 'text' : 'password';
                mask.firstChild.textContent = input.type === 'password' ? 'visibility' : 'visibility_off';
            } }, icon('visibility', 'text-[18px]'));

            const test = async () => {
                save({ quiet: true });
                if (!keys[id]) return showFeedback('error', 'Bitte zuerst einen Key eintragen.');
                setBadge(null, 'Prüfe …');
                const result = await testKey(meta, keys[id]);
                setBadge(result.ok ? 'ok' : 'error', result.ok ? 'Verbunden' : 'Fehler');
                showFeedback(result.ok ? 'ok' : 'error', result.message);
            };

            return h('div', { class: 'key-card' },
                h('div', { class: 'flex flex-col gap-3' },
                    h('div', { class: 'flex items-start justify-between gap-3' },
                        h('div', { class: 'flex items-center gap-3 min-w-0' },
                            h('div', { class: 'provider-icon' }, icon(meta.icon)),
                            h('div', { class: 'min-w-0' },
                                h('h3', { class: 'font-headline text-on-surface font-semibold text-[15px]', text: meta.label }),
                                h('p', { class: 'text-on-surface-variant text-[12px]', text: meta.description }))),
                        badge),
                    h('div', { class: 'flex flex-col gap-1.5' },
                        h('label', { class: 'field-label', for: inputId, text: 'API-Key' }),
                        h('div', { class: 'key-input-wrap' }, input, mask)),
                    feedback),
                h('div', { class: 'flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-outline-variant/20' },
                    h('div', { class: 'flex gap-2' },
                        h('button', { class: 'btn-primary', onclick: () => save() }, 'Speichern'),
                        h('button', { class: 'btn-ghost', onclick: test }, icon('network_ping', 'text-[16px]'), 'Test-Ping')),
                    h('a', { href: meta.keyUrl, target: '_blank', rel: 'noopener noreferrer', class: 'link-btn' },
                        'Key erstellen', icon('open_in_new', 'text-[13px]'))));
        };
        $('key-cards-stt').replaceChildren(...Object.keys(S.apis).map(card));
        $('key-cards-llm').replaceChildren(...Object.keys(LLM_KEYS).map(card));
    }

    // A cheap GET that proves the key works – and that the provider accepts browser requests.
    async function testKey(meta, key) {
        const { url, headers } = meta.test(key);
        try {
            const res = await fetch(url, { headers });
            if (res.ok) return { ok: true, message: 'Key gültig – Anfragen direkt aus dem Browser funktionieren.' };
            if (res.status === 401 || res.status === 403) return { ok: false, message: `Key ungültig oder ohne Berechtigung (HTTP ${res.status}).` };
            return { ok: false, message: `Der Anbieter antwortet mit HTTP ${res.status}. Bitte später erneut prüfen.` };
        } catch (_) {
            return {
                ok: false,
                message: 'Anfrage wurde blockiert. Entweder fehlt die Internetverbindung, oder der Anbieter lässt keine Anfragen direkt aus dem Browser zu (CORS) – dann funktioniert er in Scribe Studio nicht.'
            };
        }
    }

    function clearKeys() {
        if (!confirm('Alle gespeicherten API-Keys aus diesem Browser löschen?')) return;
        for (const id of allKeyIds()) storeKey(id, '');
        renderKeyCards();
        keysChanged();
        setStatus('Alle API-Keys gelöscht.', 'success');
    }

    // --- Provider selection ---
    function renderProviderCards() {
        const cards = Object.entries(S.apis).map(([id, api]) => {
            const vocab = api.vocabularySupport?.(api.models[0].id);
            const chips = [
                h('span', { class: 'chip chip-ok' }, h('span', { class: 'dot' }), 'Sprecher'),
                h('span', { class: 'chip' + (vocab ? ' chip-ok' : '') }, h('span', { class: 'dot' }), vocab ? 'Fachbegriffe' : 'Fachbegriffe teilweise'),
                keys[id] ? null : h('span', { class: 'chip chip-warn' }, icon('key_off', 'text-[12px]'), 'Key fehlt')
            ];
            const checked = id === selectedProvider;
            return h('button', {
                type: 'button', class: 'provider-card', role: 'radio', 'aria-checked': String(checked),
                onclick: () => selectProvider(id)
            },
                h('div', { class: 'flex items-center justify-between gap-2' },
                    h('div', { class: 'flex items-center gap-2.5 min-w-0' },
                        h('span', { class: 'provider-icon' }, icon(api.icon)),
                        h('div', { class: 'min-w-0' },
                            h('h3', { class: 'font-headline text-[16px] text-on-surface font-semibold', text: api.label }),
                            h('p', { class: 'font-code text-outline text-[11px] truncate', text: api.models[0].name }))),
                    icon(checked ? 'radio_button_checked' : 'radio_button_unchecked', 'provider-radio')),
                h('p', { class: 'text-on-surface-variant text-[13px]', text: api.description }),
                h('div', { class: 'flex flex-wrap gap-1.5 mt-auto pt-1' }, ...chips));
        });
        $('provider-cards').replaceChildren(...cards);
        const missing = !keys[selectedProvider];
        $('provider-key-note').textContent = missing ? 'Key fehlt → API-Einstellungen' : 'Key hinterlegt';
        $('provider-key-note').className = 'font-code text-[11px] ' + (missing ? 'text-error' : 'text-secondary');
    }

    function selectProvider(id, { keepModel = false } = {}) {
        selectedProvider = S.apis[id] ? id : Object.keys(S.apis)[0];
        const api = S.apis[selectedProvider];
        const previousModel = $('model-select').value;
        $('model-select').replaceChildren(...api.models.map(m => h('option', { value: m.id, text: m.name })));
        if (keepModel && api.models.some(m => m.id === previousModel)) $('model-select').value = previousModel;
        renderProviderCards();
        updateHint();
        saveConfig();
    }

    // --- Configuration (remembered per browser) ---
    const CONFIG_KEY = 'scribe_config';
    const CONFIG_FIELDS = ['model-select', 'language-select', 'diarize', 'num-speakers'];

    function saveConfig() {
        const values = { provider: selectedProvider };
        for (const id of CONFIG_FIELDS) values[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
        try { localStorage.setItem(CONFIG_KEY, JSON.stringify(values)); } catch (_) {}
    }

    function loadConfig() {
        let values = {};
        try { values = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {}; } catch (_) {}
        selectProvider(values.provider || values['provider-select'] || 'gladia');
        for (const id of CONFIG_FIELDS) {
            if (!(id in values)) continue;
            if ($(id).type === 'checkbox') $(id).checked = values[id];
            else if ($(id).tagName !== 'SELECT' || [...$(id).options].some(o => o.value === values[id])) $(id).value = values[id];
        }
        updateHint();
    }

    function vocabularySupport() {
        const api = S.apis[selectedProvider];
        return api.vocabularySupport ? api.vocabularySupport($('model-select').value) : null;
    }

    function updateHint() {
        const api = S.apis[selectedProvider];
        $('speaker-options').classList.toggle('hidden', !$('diarize').checked);
        $('language-select').disabled = !!api.autoLanguageOnly;

        const hints = [];
        const limitMsg = limitMessage(selectedProvider);
        if (limitMsg) hints.push(limitMsg);
        if (api.autoLanguageOnly) hints.push(`${api.label} erkennt die Sprache automatisch.`);
        if ($('model-select').value === 'solaria-3' && $('language-select').value === 'auto') {
            hints.push('Solaria 3 braucht eine feste Sprache. Bitte eine Sprache wählen oder auf Solaria 1 wechseln.');
        }
        $('model-hint').textContent = hints.join(' ');
        $('model-hint').classList.toggle('hidden', !hints.length);

        const vocabHint = S.vocabulary.describe(vocabularySupport());
        $('vocab-hint').textContent = vocabHint;
        $('vocab-hint').classList.toggle('hidden', !vocabHint);

        $('start-btn-text').textContent = `Transkription starten (${api.label.split(' ')[0]})`;
        $('start-hint').textContent = !currentFile
            ? 'Zuerst eine Datei wählen oder aufnehmen.'
            : !keys[selectedProvider]
                ? `Für ${api.label} fehlt noch der API-Key.`
                : `Bereit: ${currentFile.name}${currentDuration ? ` · ${S.format.clock(currentDuration)}` : ''}`;
    }

    // --- Provider limits: file size and duration are checked before anything is uploaded ---
    function formatSize(bytes) {
        return bytes >= 1024 * MB
            ? (bytes / (1024 * MB)).toFixed(1).replace('.', ',') + ' GB'
            : Math.max(1, Math.round(bytes / MB)) + ' MB';
    }

    function limitProblems(providerId) {
        if (!currentFile) return [];
        const api = S.apis[providerId];
        const lim = api.limits ? api.limits() : {};
        const problems = [];
        if (lim.maxBytes && currentFile.size > lim.maxBytes) {
            problems.push(`Die Datei ist ${formatSize(currentFile.size)} groß, ${api.label} nimmt höchstens ${formatSize(lim.maxBytes)} an.`);
        }
        if (lim.maxSeconds && currentDuration && currentDuration > lim.maxSeconds) {
            problems.push(`Die Aufnahme ist ${S.format.clock(currentDuration)} lang, ${api.label} verarbeitet höchstens ${S.format.clock(lim.maxSeconds)}.`);
        }
        return problems;
    }

    function limitMessage(providerId) {
        const problems = limitProblems(providerId);
        if (!problems.length) return '';
        const fitting = Object.keys(S.apis).filter(id => id !== providerId && !limitProblems(id).length);
        return problems.join(' ') + (fitting.length
            ? ` Passende Anbieter: ${fitting.map(id => S.apis[id].label).join(', ')}.`
            : ' Bitte die Datei kürzen oder teilen.');
    }

    // The duration is known once the player has read the file's metadata (usually instantly).
    // If the browser can't decode the file (player error), skip the duration check – the
    // provider may still accept the format, and the size check applies regardless.
    function waitForDuration(timeoutMs = 3000) {
        const player = $('audio-player');
        if (currentDuration || !currentFile || player.error) return Promise.resolve();
        setStatus('Prüfe Audiodatei …');
        return new Promise(resolve => {
            const done = () => {
                player.removeEventListener('durationchange', check);
                player.removeEventListener('error', done);
                clearTimeout(timer);
                resolve();
            };
            const check = () => { if (currentDuration) done(); };
            const timer = setTimeout(done, timeoutMs);
            player.addEventListener('durationchange', check);
            player.addEventListener('error', done);
        });
    }

    function trackDuration() {
        const player = $('audio-player');
        const update = () => {
            if (!Number.isFinite(player.duration) || player.duration <= 0 || player.duration === currentDuration) return;
            currentDuration = player.duration;
            $('file-duration').textContent = S.format.clock(currentDuration);
            $('file-duration-wrap').classList.replace('hidden', 'flex');
            updateHint();
        };
        player.addEventListener('loadedmetadata', update);
        player.addEventListener('durationchange', update);
    }

    // Chrome's MediaRecorder writes WebM without a duration, so the player reports Infinity
    // and can't show progress or seek properly. Seeking far past the end makes it compute
    // the real duration; then jump back to the start.
    function fixUnknownDuration() {
        const player = $('audio-player');
        player.addEventListener('loadedmetadata', () => {
            if (player.duration !== Infinity) return;
            const reset = () => {
                player.removeEventListener('durationchange', reset);
                player.currentTime = 0;
            };
            player.addEventListener('durationchange', reset);
            player.currentTime = 1e101;
        });
    }

    function getSpeakerCount() {
        const n = parseInt($('num-speakers').value, 10);
        return Number.isInteger(n) && n > 0 ? n : null;
    }

    // --- File handling ---
    function setupDropZone() {
        const zone = $('drop-zone');
        zone.addEventListener('click', () => $('file-input').click());
        zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file-input').click(); } });
        ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('is-dragover'); }));
        ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('is-dragover'); }));
        zone.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
        $('file-input').addEventListener('change', e => { handleFile(e.target.files[0]); e.target.value = ''; });
    }

    function handleFile(file) {
        if (!file) return;
        if (S.recorder.isActive()) {
            setStatus('Bitte zuerst die laufende Aufnahme stoppen.', 'error');
            return;
        }
        currentFile = file;
        currentDuration = null;
        // Embedding large audio makes the HTML export heavy; start with it off for big files.
        $('export-audio').checked = file.size <= HTML_AUDIO_WARN_BYTES;
        $('file-name').textContent = file.name;
        $('file-size').textContent = (file.size / MB).toFixed(1).replace('.', ',') + ' MB';
        $('file-duration-wrap').classList.replace('flex', 'hidden');
        $('file-info').classList.remove('hidden');
        $('drop-zone').classList.add('hidden');
        $('start-btn').disabled = false;

        const player = $('audio-player');
        if (player.src) URL.revokeObjectURL(player.src);
        player.src = URL.createObjectURL(file);
        updatePlayerVisibility();
        updateHint();
    }

    function clearFile() {
        if (S.recorder.isActive()) return;
        currentFile = null;
        currentDuration = null;
        const player = $('audio-player');
        if (player.src) URL.revokeObjectURL(player.src);
        player.removeAttribute('src');
        player.load();
        $('file-info').classList.add('hidden');
        $('drop-zone').classList.remove('hidden');
        $('start-btn').disabled = true;
        updatePlayerVisibility();
        updateHint();
    }

    function updatePlayerVisibility() {
        const hasTranscript = S.state.get().segments.length > 0;
        $('player-bar').classList.toggle('hidden', !currentFile);
        $('player-missing').classList.toggle('hidden', !!currentFile || !hasTranscript);
    }

    // --- Transcription ---
    async function startTranscription() {
        if (!currentFile) return;
        if (S.state.get().segments.length && !confirm('Das aktuelle Transkript inklusive deiner Änderungen wird ersetzt. Fortfahren?')) return;

        const provider = selectedProvider;
        await waitForDuration();
        const limitMsg = limitMessage(provider);
        if (limitMsg) {
            setStatus(limitMsg, 'error');
            return;
        }

        const diarize = $('diarize').checked;
        const { terms: vocabulary } = S.vocabulary.prepare(S.vocabulary.getTerms(), vocabularySupport());
        $('start-btn').disabled = true;
        const startedAt = Date.now();

        try {
            const { raw, segments } = await S.apis[provider].transcribe(currentFile, {
                key: getKey(provider),
                model: $('model-select').value,
                language: $('language-select').value,
                diarize,
                speakers: diarize ? getSpeakerCount() : null,
                vocabulary,
                onStatus: text => setStatus(text)
            });
            S.state.setTranscript({ raw, segments, provider, fileName: currentFile.name });
            S.recorder.markUsed(currentFile);
            switchView('transcript');
            setStatus(`Transkription abgeschlossen (${Math.round((Date.now() - startedAt) / 1000)} s).`, 'success');
        } catch (err) {
            showError('Fehler', err);
        } finally {
            $('start-btn').disabled = !currentFile;
        }
    }

    // --- Transcript header ---
    let headerFrame = null;

    function updateTranscriptView() {
        cancelAnimationFrame(headerFrame);
        headerFrame = requestAnimationFrame(() => {
            const { segments, provider, fileName } = S.state.get();
            const has = segments.length > 0;
            $('transcript-empty').classList.toggle('hidden', has);
            $('transcript-content').classList.toggle('hidden', !has);
            document.querySelectorAll('[data-needs-transcript]').forEach(b => { b.disabled = !has; });
            updatePlayerVisibility();
            if (!has) return;

            $('transcript-title').textContent = fileName ? S.export.baseName() : 'Transkript';
            const duration = segments.reduce((max, s) => Math.max(max, s.end), 0);
            const speakers = new Set(segments.map(s => s.speaker).filter(Boolean)).size;
            const words = segments.reduce((n, s) => n + (s.text.match(/\S+/g)?.length || 0), 0);
            const item = (name, text) => h('span', { class: 'flex items-center gap-1.5' }, icon(name, 'text-[15px] text-outline'), text);
            $('transcript-meta').replaceChildren(
                duration > 0 ? item('schedule', S.format.clock(duration)) : null,
                speakers ? item('groups', `${speakers} Sprecher`) : null,
                item('notes', `${words.toLocaleString('de-DE')} Wörter`),
                provider && S.apis[provider] ? item('graphic_eq', S.apis[provider].label) : null
            );
        });
    }

    // --- Export menu & project files ---
    function setupExportMenu() {
        const toggle = $('export-toggle');
        const menu = $('export-menu');
        const setOpen = open => {
            menu.classList.toggle('hidden', !open);
            toggle.setAttribute('aria-expanded', String(open));
            if (open) {
                const audio = $('export-audio');
                audio.disabled = !currentFile;
                audio.parentElement.title = currentFile ? '' : 'Keine Audiodatei geladen';
                // Base64 embedding adds about a third to the audio size.
                const note = $('export-audio-note');
                note.textContent = currentFile ? `HTML-Datei wird ca. ${formatSize(currentFile.size * 1.34)} groß` : '';
                note.classList.toggle('is-warning', !!currentFile && currentFile.size > HTML_AUDIO_WARN_BYTES);
                menu.querySelector('[role="menuitem"]').focus();
            }
        };
        toggle.addEventListener('click', () => setOpen(menu.classList.contains('hidden')));
        document.addEventListener('click', e => { if (!e.target.closest('.export-wrap')) setOpen(false); });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !menu.classList.contains('hidden')) { setOpen(false); toggle.focus(); }
        });
        menu.querySelectorAll('[data-export]').forEach(item => item.addEventListener('click', () => {
            setOpen(false);
            S.export.exportAs(item.dataset.export, {
                includeSummary: $('export-summary').checked,
                audioFile: item.dataset.export === 'html' && $('export-audio').checked ? currentFile : null
            });
        }));
    }

    async function openProject(file) {
        if (!file) return;
        if (S.state.get().segments.length && !confirm('Das aktuelle Transkript inklusive deiner Änderungen wird ersetzt. Fortfahren?')) return;
        try {
            const data = JSON.parse(await file.text());
            S.state.loadProject(data);
            S.summary.setText(data.summary);
            const audioHint = data.fileName && !currentFile ? ` Für den Player die Audiodatei „${data.fileName}“ laden.` : '';
            switchView('transcript');
            setStatus(`Projekt geöffnet: ${S.state.get().segments.length} Abschnitte.${audioHint}`, 'success');
        } catch (err) {
            setStatus(err instanceof SyntaxError ? 'Die Datei ist kein gültiges JSON.' : err.message, 'error');
        }
    }

    // The header wraps on narrow screens; sticky elements below it need its real height.
    function trackHeaderHeight() {
        const header = $('app-header');
        const update = () => document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
        update();
        if (window.ResizeObserver) new ResizeObserver(update).observe(header);
    }

    // --- Init ---
    function init() {
        trackHeaderHeight();
        S.ui = { setStatus, showError, copy, getKey };
        S.app = { hasFile: () => !!currentFile, getFile: () => currentFile, switchView };

        loadKeys();
        renderKeyCards();
        renderKeyStatus();
        S.vocabulary.init();
        S.vocabulary.onChange(updateHint);
        loadConfig();
        CONFIG_FIELDS.forEach(id => $(id).addEventListener('change', () => { updateHint(); saveConfig(); }));
        setupDropZone();
        S.recorder.init({ onRecorded: handleFile });
        fixUnknownDuration();
        trackDuration();

        document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => switchView(el.dataset.view)));
        $('status-close').addEventListener('click', hideStatus);
        $('clear-keys').addEventListener('click', clearKeys);
        $('start-btn').addEventListener('click', startTranscription);
        $('file-clear').addEventListener('click', clearFile);
        $('player-load').addEventListener('click', () => $('file-input').click());

        setupExportMenu();
        const openPicker = () => $('project-file').click();
        ['open-project', 'open-project-start', 'open-project-empty'].forEach(id => $(id).addEventListener('click', openPicker));
        $('project-file').addEventListener('change', e => { openProject(e.target.files[0]); e.target.value = ''; });
        $('copy-transcript').addEventListener('click', () => copy(S.export.toText()));
        $('clear-transcript').addEventListener('click', () => {
            if (confirm('Transkript und alle Änderungen verwerfen?')) S.state.clear();
        });

        S.editor.init({
            list: $('segment-list'),
            speakers: $('speaker-panel'),
            audio: $('audio-player'),
            follow: $('follow-playback')
        });
        S.summary.init();
        S.state.subscribe(type => { if (type !== 'text') updateTranscriptView(); });

        const firstVisit = !Object.keys(S.apis).some(id => keys[id]);
        const restored = S.state.restore();
        updateTranscriptView();
        switchView(firstVisit ? 'settings' : 'start');
        if (firstVisit) {
            setStatus('Willkommen! Trage zuerst den API-Key für mindestens einen Anbieter ein.', 'success');
        } else if (restored) {
            const name = S.state.get().fileName;
            setStatus(`Letztes Transkript wiederhergestellt${name ? ` (${name})` : ''}. Du findest es unter „Transkript & Export“.`, 'success');
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})(window.Scribe);

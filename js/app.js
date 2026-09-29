/*
 * App wiring: views (sidebar pages), engine chips, API keys (with test ping), file handling,
 * transcription run, status message, transcript header and export menu.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const $ = id => document.getElementById(id);

    const MB = 1024 * 1024;
    const HTML_AUDIO_WARN_BYTES = 25 * MB;
    const KEY_PREFIX = 'unisono_key_';

    // Keys for the AI summary; the transcription providers come from S.apis.
    const LLM_KEYS = {
        anthropic: {
            label: 'Anthropic (Claude)',
            description: 'Für Zusammenfassungen, Stichpunkte und Protokolle.',
            keyUrl: 'https://console.anthropic.com/settings/keys',
            keyGuide: {
                steps: [
                    'In der Anthropic Console (console.anthropic.com) ein Konto anlegen.',
                    'Unter „Billing“ Guthaben aufladen – die API wird vorab bezahlt, ein Claude-Abo gilt hier nicht.',
                    'Unter „Settings → API Keys“ auf „Create Key“ klicken und den Key sofort kopieren.',
                    'Hier einfügen und mit „Prüfen“ testen.'
                ],
                note: 'Unter „Limits“ lässt sich eine monatliche Obergrenze setzen.'
            },
            test: key => ({
                url: 'https://api.anthropic.com/v1/models',
                headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
            })
        },
        openai: {
            label: 'OpenAI',
            description: 'Alternative für Zusammenfassungen.',
            keyUrl: 'https://platform.openai.com/api-keys',
            keyGuide: {
                steps: [
                    'Auf platform.openai.com ein Konto anlegen.',
                    'Unter „Billing“ Guthaben aufladen – ein ChatGPT-Abo gilt für die API nicht.',
                    'Unter „API keys“ auf „Create new secret key“ klicken und den Key sofort kopieren.',
                    'Hier einfügen und mit „Prüfen“ testen.'
                ],
                note: 'Unter „Limits“ lässt sich eine monatliche Obergrenze setzen.'
            },
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

    const icon = (name, cls = '') => S.icon(name, cls);
    const dot = id => h('span', { class: 'provider-dot', 'data-provider': id, 'aria-hidden': 'true' });
    const shortLabel = api => api.label.split(' (')[0];

    // --- Status line (shared with the other modules via S.ui) ---
    function setStatus(text, type = 'info') {
        clearTimeout(statusTimer);
        $('status-banner').className = 'status-banner status-' + type;
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
        if (!$('view-' + name)) name = 'start';
        document.querySelectorAll('.view').forEach(view => {
            const show = view.id === 'view-' + name;
            view.classList.toggle('hidden', !show);
            if (show) {
                // Restart the entrance animation.
                view.classList.remove('is-entering');
                void view.offsetWidth;
                view.classList.add('is-entering');
            }
        });
        document.querySelectorAll('.nav-item').forEach(item => {
            if (item.dataset.view === name) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });
        if (name === 'settings') S.settings.refreshData();
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
        // Keys and settings of the app's former name (Scribe Studio) are not carried over.
        try {
            Object.keys(localStorage).filter(k => k.startsWith('scribe_')).forEach(k => localStorage.removeItem(k));
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
        if (!keys[id]) throw new Error(`Bitte zuerst den API-Key für ${keyMeta(id).label} unter „API-Keys“ eintragen.`);
        return keys[id];
    }

    function keysChanged() {
        renderKeyStatus();
        renderProviderCards();
        updateHint();
        S.settings.refresh();
    }

    // Sidebar (and on mobile the top bar): which engines have a key.
    function renderKeyStatus() {
        const ids = Object.keys(S.apis);
        const withKey = ids.filter(id => keys[id]).length;
        $('topbar-keys').replaceChildren(...ids.map(id => {
            const d = dot(id);
            if (!keys[id]) d.classList.add('is-empty');
            return d;
        }));
        $('topbar-keys').setAttribute('aria-label', `${withKey} von ${ids.length} Engines mit Key. API-Keys öffnen`);
        $('topbar-keys').title = ids.map(id => `${shortLabel(S.apis[id])}: ${keys[id] ? 'Key hinterlegt' : 'kein Key'}`).join('\n');
        $('provider-status').replaceChildren(...Object.entries(S.apis).map(([id, api]) =>
            h('li', {},
                h('button', { type: 'button', class: 'provider-status-item', onclick: () => switchView('keys') },
                    dot(id),
                    h('span', { class: 'provider-status-name', text: shortLabel(api) }),
                    h('span', { class: 'status-dot ' + (keys[id] ? 'is-success' : 'is-idle'), 'aria-hidden': 'true' }),
                    h('span', { class: 'visually-hidden', text: keys[id] ? ', Key hinterlegt' : ', kein Key' })))));
    }

    function renderKeyCards() {
        const row = id => {
            const meta = keyMeta(id);
            const isEngine = !!S.apis[id];
            const inputId = 'key-' + id;
            const input = h('input', { id: inputId, type: 'password', class: 'input is-mono', autocomplete: 'off', spellcheck: false, placeholder: 'Key einfügen', value: keys[id] });
            const status = h('span', { class: 'key-status t-small' });
            const feedback = h('p', { class: 'key-feedback t-small hidden', 'aria-live': 'polite' });
            const setStatusText = (state, text) => {
                status.replaceChildren(h('span', { class: 'status-dot is-' + state, 'aria-hidden': 'true' }), text);
            };
            const showFeedback = (state, text) => {
                feedback.className = 'key-feedback t-small is-' + state;
                feedback.replaceChildren(h('span', { class: 'status-dot is-' + state, 'aria-hidden': 'true' }), h('span', { text }));
            };
            const removeBtn = h('button', { type: 'button', class: 'btn-text is-danger', onclick: () => remove() }, 'Entfernen');
            const refreshStatus = () => {
                removeBtn.disabled = !keys[id];
                return keys[id] ? setStatusText('success', 'Gespeichert') : setStatusText('idle', 'Kein Key');
            };
            refreshStatus();

            // Saved silently while typing: anything that changes on blur (status, message) can
            // re-wrap the row and move the buttons, so a click on "Prüfen" would miss.
            const save = ({ quiet = false } = {}) => {
                const persisted = storeKey(id, input.value);
                refreshStatus();
                keysChanged();
                if (!persisted) showFeedback('danger', 'Der Browser blockiert das Speichern. Der Key gilt nur bis zum Schließen der Seite.');
                else if (!quiet) showFeedback('info', keys[id] ? 'Key gespeichert.' : 'Key entfernt.');
            };
            input.addEventListener('input', () => save({ quiet: true }));

            const mask = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Key anzeigen', title: 'Anzeigen / verbergen', onclick: () => {
                input.type = input.type === 'password' ? 'text' : 'password';
                const hidden = input.type === 'password';
                S.setIcon(mask.firstChild, hidden ? 'eye' : 'eye-off');
                mask.setAttribute('aria-label', hidden ? 'Key anzeigen' : 'Key verbergen');
            } }, icon('eye'));

            const test = async () => {
                save({ quiet: true });
                if (!keys[id]) return showFeedback('danger', 'Bitte zuerst einen Key eintragen.');
                setStatusText('info', 'Prüfe …');
                const result = await testKey(meta, keys[id]);
                setStatusText(result.ok ? 'success' : 'danger', result.ok ? 'Verbunden' : 'Fehler');
                showFeedback(result.ok ? 'success' : 'danger', result.message);
            };

            const remove = () => {
                if (!keys[id]) return;
                input.value = '';
                save();
            };

            return h('div', { class: 'key-row' },
                h('div', { class: 'key-provider' },
                    isEngine ? dot(id) : null,
                    h('div', { class: 'min-w-0' },
                        h('h3', { class: 'key-name' }, meta.label, S.brandLogo(id)),
                        h('p', { class: 't-small muted', text: meta.description }))),
                h('div', { class: 'key-input' },
                    h('label', { class: 'visually-hidden', for: inputId, text: `API-Key für ${meta.label}` }),
                    h('div', { class: 'input-wrap' }, input, mask)),
                status,
                h('div', { class: 'key-actions' },
                    h('button', { type: 'button', class: 'btn-secondary is-small', onclick: test }, 'Prüfen'),
                    removeBtn),
                h('div', { class: 'key-more' }, feedback, keyGuide(meta)));
        };
        $('key-cards-stt').replaceChildren(...Object.keys(S.apis).map(row));
        $('key-cards-llm').replaceChildren(...Object.keys(LLM_KEYS).map(row));
    }

    // Step-by-step guide to getting a key, folded away until asked for.
    function keyGuide(meta) {
        const guide = meta.keyGuide;
        if (!guide) return null;
        const host = new URL(meta.keyUrl).hostname.replace(/^www\./, '');
        return h('details', { class: 'key-guide' },
            h('summary', {}, icon('help'), 'So bekommst du einen Key'),
            h('ol', {}, ...guide.steps.map(step => h('li', { text: step }))),
            guide.note ? h('p', { class: 't-small muted', text: guide.note }) : null,
            h('a', { href: meta.keyUrl, target: '_blank', rel: 'noopener noreferrer', class: 'btn-text' },
                `Key-Seite öffnen (${host})`, icon('external')));
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
                message: 'Anfrage wurde blockiert. Entweder fehlt die Internetverbindung, oder der Anbieter lässt keine Anfragen direkt aus dem Browser zu (CORS) – dann funktioniert er in Unisono nicht.'
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

    // --- Engine selection: one chip per provider, the active one filled ---
    function renderProviderCards() {
        const chips = Object.entries(S.apis).map(([id, api]) => {
            const active = id === selectedProvider;
            return h('button', {
                type: 'button', class: 'engine-chip', 'aria-pressed': String(active),
                onclick: () => selectProvider(id)
            },
                dot(id),
                shortLabel(api),
                keys[id] ? null : ' ',
                keys[id] ? null : h('span', { class: 'chip-note t-mono', text: 'kein Key' }));
        });
        $('provider-cards').replaceChildren(...chips);

        const api = S.apis[selectedProvider];
        const vocab = api.vocabularySupport?.($('model-select').value || api.models[0].id);
        $('provider-info').textContent = api.description + (vocab ? '' : ' Fachbegriffe nur teilweise.');
        const missing = !keys[selectedProvider];
        $('provider-key-note').textContent = missing ? `Key für ${shortLabel(api)} eintragen` : '';
        $('provider-key-note').classList.toggle('hidden', !missing);
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
    const CONFIG_KEY = 'unisono_config';
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
        const termCount = S.vocabulary.count();
        $('vocab-hint').textContent = vocabHint || (termCount
            ? `Ausgeschaltet – ${termCount} Begriff${termCount === 1 ? '' : 'e'} werden nicht mitgeschickt.`
            : 'Noch keine Fachbegriffe. Namen und Fachwörter in einer Liste verbessern die Erkennung.');
        $('vocab-hint-settings').textContent = vocabHint ? `Mit ${api.label}: ${vocabHint}` : '';
        $('vocab-hint-settings').classList.toggle('hidden', !vocabHint);

        $('start-btn-text').textContent = `Mit ${shortLabel(api)} transkribieren`;
        const language = $('language-select');
        $('start-summary').textContent = [
            $('model-select').selectedOptions[0]?.textContent.split(' (')[0],
            api.autoLanguageOnly ? 'Sprache automatisch' : language.selectedOptions[0]?.textContent,
            $('diarize').checked ? `Sprecher erkennen${getSpeakerCount() ? ` (${getSpeakerCount()})` : ''}` : 'ohne Sprechertrennung',
            S.vocabulary.isEnabled() && termCount ? `${termCount} Fachbegriff${termCount === 1 ? '' : 'e'}` : null
        ].filter(Boolean).join(' · ');
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
            $('file-duration-wrap').classList.remove('hidden');
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
        $('file-duration-wrap').classList.add('hidden');
        const ext = file.name.includes('.') ? file.name.split('.').pop().toUpperCase() : '';
        $('file-format').textContent = ext ? ` · ${ext}` : '';
        $('file-info').classList.remove('hidden');
        $('drop-zone').classList.add('hidden');
        $('start-btn').disabled = false;

        const player = $('audio-player');
        if (player.src) URL.revokeObjectURL(player.src);
        player.src = URL.createObjectURL(file);
        S.player.setFile(file);
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
        S.player.setFile(null);
        $('file-info').classList.add('hidden');
        $('drop-zone').classList.remove('hidden');
        $('start-btn').disabled = true;
        updatePlayerVisibility();
        updateHint();
    }

    function updatePlayerVisibility() {
        const hasTranscript = S.state.get().segments.length > 0;
        // The timeline also helps without audio (who spoke when), so the bar shows with a transcript.
        $('player-bar').classList.toggle('hidden', !currentFile && !hasTranscript);
        $('player-load').classList.toggle('hidden', !!currentFile);
        S.player.redraw();
    }

    // --- Transcription ---
    let running = null;

    async function startTranscription() {
        if (!currentFile || running) return;
        if (S.state.get().segments.length && !confirm('Das aktuelle Transkript inklusive deiner Änderungen wird ersetzt. Fortfahren?')) return;

        const provider = selectedProvider;
        const file = currentFile;
        const model = $('model-select').value;
        running = new AbortController();
        hideStatus();
        S.progress.begin({ file, provider, model, duration: currentDuration, cancel: () => running?.abort() });

        try {
            await waitForDuration();
            const limitMsg = limitMessage(provider);
            if (limitMsg) throw new Error(limitMsg);

            const diarize = $('diarize').checked;
            const { terms: vocabulary } = S.vocabulary.prepare(S.vocabulary.getTerms(), vocabularySupport());
            const startedAt = Date.now();
            const { raw, segments } = await S.apis[provider].transcribe(file, {
                key: getKey(provider),
                model,
                language: $('language-select').value,
                diarize,
                speakers: diarize ? getSpeakerCount() : null,
                vocabulary,
                signal: running.signal,
                onStage: (stage, text) => S.progress.stage(stage, text),
                onUpload: fraction => S.progress.upload(fraction)
            });
            S.progress.stage('done');
            S.state.setTranscript({ raw, segments, provider, fileName: file.name });
            S.recorder.markUsed(file);
            S.progress.end();
            switchView('transcript');
            setStatus(`Transkription abgeschlossen (${S.format.clock((Date.now() - startedAt) / 1000)}).`, 'success');
        } catch (err) {
            S.progress.end();
            if (err?.name === 'AbortError') setStatus('Transkription abgebrochen. Beim Anbieter bereits hochgeladene Daten löscht er nach seinen eigenen Regeln.', 'error');
            else showError('Fehler', err);
        } finally {
            running = null;
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
            const api = provider && S.apis[provider];
            $('transcript-eyebrow').replaceChildren(...(api ? [dot(provider), `Transkript · ${shortLabel(api)}`] : ['Transkript']));
            const duration = segments.reduce((max, s) => Math.max(max, s.end), 0);
            const speakers = new Set(segments.map(s => s.speaker).filter(Boolean)).size;
            const words = segments.reduce((n, s) => n + (s.text.match(/\S+/g)?.length || 0), 0);
            $('transcript-meta').replaceChildren(...[
                duration > 0 ? S.format.clock(duration) : null,
                speakers ? `${speakers} Sprecher` : null,
                `${words.toLocaleString('de-DE')} Wörter`
            ].filter(Boolean).map(text => h('span', { text })));
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
        menu.querySelectorAll('[data-export]').forEach(item => item.addEventListener('click', async () => {
            setOpen(false);
            // While the file is built (embedding audio can take seconds) the button says so.
            toggle.disabled = true;
            toggle.textContent = 'Wird erstellt …';
            try {
                await S.export.exportAs(item.dataset.export, {
                    includeSummary: $('export-summary').checked,
                    audioFile: item.dataset.export === 'html' && $('export-audio').checked ? currentFile : null
                });
            } finally {
                toggle.textContent = 'Exportieren';
                toggle.disabled = !S.state.get().segments.length;
            }
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

    function setupStartOptions() {
        const toggle = $('start-options-toggle');
        toggle.addEventListener('click', () => {
            const open = toggle.getAttribute('aria-expanded') !== 'true';
            toggle.setAttribute('aria-expanded', String(open));
            $('start-options').classList.toggle('hidden', !open);
            S.setIcon(toggle.querySelector('.icon'), open ? 'chev-up' : 'chev-down');
        });
    }

    // --- Init ---
    function init() {
        S.ui = { setStatus, showError, copy, getKey };
        S.app = { hasFile: () => !!currentFile, getFile: () => currentFile, switchView, openSettings: tab => S.settings.open(tab) };

        loadKeys();
        renderKeyCards();
        renderKeyStatus();
        S.vocabulary.init();
        S.vocabulary.onChange(updateHint);
        S.settings.init({
            keyCount: () => ({ saved: allKeyIds().filter(id => keys[id]).length, total: allKeyIds().length })
        });
        loadConfig();
        CONFIG_FIELDS.forEach(id => $(id).addEventListener('change', () => { updateHint(); saveConfig(); }));
        setupDropZone();
        setupStartOptions();
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

        S.player.init();
        S.editor.init({
            list: $('segment-list'),
            speakers: $('speaker-panel'),
            audio: $('audio-player'),
            follow: $('follow-playback')
        });
        S.search.init();
        S.summary.init();
        const showLlmLogo = () => $('llm-logo').replaceChildren(...[S.brandLogo($('llm-provider').value)].filter(Boolean));
        $('llm-provider').addEventListener('change', showLlmLogo);
        showLlmLogo();
        S.state.subscribe(type => { if (type !== 'text') updateTranscriptView(); });

        const firstVisit = !Object.keys(S.apis).some(id => keys[id]);
        const restored = S.state.restore();
        updateTranscriptView();
        if (firstVisit) {
            switchView('keys');
            setStatus('Willkommen. Trage zuerst den API-Key für mindestens eine Engine ein.', 'success');
        } else {
            switchView('start');
            if (restored) {
                const name = S.state.get().fileName;
                setStatus(`Letztes Transkript wiederhergestellt${name ? ` (${name})` : ''}. Du findest es unter „Transkript“.`, 'success');
            }
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})(window.Unisono);

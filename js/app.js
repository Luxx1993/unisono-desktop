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

    // Keys of the text AI providers (S.llms) that have no speech engine of their own. A provider that
    // is both (OpenAI, Groq, Gemini, …) has one row under S.apis, and that key serves both purposes.
    const LLM_KEYS = {};
    const refreshLlmKeys = () => {
        for (const id of Object.keys(LLM_KEYS)) delete LLM_KEYS[id];
        for (const [id, llm] of Object.entries(S.llms)) if (!S.apis[id]) LLM_KEYS[id] = llm;
    };
    // Every speech engine can transcribe files; those without speaker separation (noDiarization) say so.
    const engineIds = () => Object.keys(S.apis);
    const hasEngineKey = id => isConfigured(id);
    const engineIdsWithKey = () => engineIds().filter(hasEngineKey);
    // An engine may share the key of another entry (AssemblyAI Sync uses the AssemblyAI key).
    const keyIdOf = id => S.apis[id]?.keyId || id;

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
    // type: 'info' (something is working, the dot pulses), 'success', 'error', 'note' (neutral hint)
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
        return [...Object.keys(S.apis).filter(id => !S.apis[id].keyId), ...Object.keys(LLM_KEYS)];
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

    // A provider is ready when its key is there (or it needs none) and its required settings
    // (Azure's endpoint, the address of an own server) are filled in.
    function missingSetting(id) {
        id = keyIdOf(id);
        return (keyMeta(id)?.settings || []).find(f => f.required && !S.providerSettings.get(id, f.field)) || null;
    }

    function isConfigured(id) {
        id = keyIdOf(id);
        const meta = keyMeta(id);
        return !!meta && !missingSetting(id) && (!!keys[id] || !!meta.keyOptional);
    }

    function getKey(id) {
        id = keyIdOf(id);
        const meta = keyMeta(id);
        const missing = missingSetting(id);
        if (missing) throw new Error(`Bitte zuerst für ${meta.label} unter „API-Keys“ ${missing.label === 'Adresse' ? 'die Adresse' : `den ${missing.label}`} eintragen.`);
        if (!keys[id] && !meta.keyOptional) throw new Error(`Bitte zuerst den API-Key für ${meta.label} unter „API-Keys“ eintragen.`);
        return keys[id] || '';
    }

    function keysChanged() {
        renderKeyStatus();
        selectProvider(selectedProvider, { keepModel: true });
        S.settings.refresh();
        S.dictation?.refresh();
        S.summary?.refresh();
    }

    // Sidebar (and on mobile the top bar): which engines have a key.
    function renderKeyStatus() {
        const ids = engineIdsWithKey();
        $('topbar-keys').replaceChildren(...ids.map(id => dot(id)));
        $('topbar-keys').setAttribute('aria-label', ids.length
            ? `${ids.length} Engines mit Key. API-Keys öffnen`
            : 'Noch kein Key hinterlegt. API-Keys öffnen');
        $('topbar-keys').title = ids.length ? ids.map(id => shortLabel(S.apis[id])).join('\n') : 'Noch kein Key hinterlegt';
        $('provider-status').replaceChildren(...(ids.length ? ids : [null]).map(id =>
            h('li', {},
                h('button', { type: 'button', class: 'provider-status-item', onclick: () => switchView('keys') },
                    id ? dot(id) : null,
                    h('span', { class: 'provider-status-name', text: id ? shortLabel(S.apis[id]) : 'Noch kein Key' }),
                    h('span', { class: 'status-dot ' + (id ? 'is-success' : 'is-idle'), 'aria-hidden': 'true' }),
                    h('span', { class: 'visually-hidden', text: id ? ', Key hinterlegt' : ', API-Keys öffnen' })))));
    }

    // What a provider does, for the filter chips on the key page (the same filters as the Android app).
    const TAG_LABELS = { stt: 'Transkription', llm: 'Umformulierung', realtime: 'Echtzeit', eu: 'EU' };
    // Providers that can transcribe live (from the Android app's catalog); Unisono itself records whole takes.
    const REALTIME_IDS = new Set(['openai', 'gemini', 'soniox', 'elevenlabs', 'deepgram', 'assembly', 'xai', 'mistral', 'gladia']);
    // Providers that keep the data in the EU by default, by their own documentation (Mistral, Scaleway, OVHcloud).
    // Gladia is French, but its documentation promises EU processing only for live transcription.
    const EU_IDS = new Set(['mistral', 'scaleway', 'ovhcloud']);
    // Providers with an EU region to choose (in the key row; Azure through the region of the resource).
    const hasEuRegion = id => id === 'azure' || (keyMeta(id)?.settings || []).some(f => f.field === 'region');
    let keyFilter = 'all';

    function providerTags(id) {
        const tags = [];
        if (S.apis[id]) tags.push('stt');
        if (S.llms[id]) tags.push('llm');
        if (S.apis[id] && REALTIME_IDS.has(id)) tags.push('realtime');
        if (EU_IDS.has(id) || hasEuRegion(id)) tags.push('eu');
        return tags;
    }

    function applyKeyFilter() {
        let shown = 0;
        document.querySelectorAll('#key-cards .key-row').forEach(rowEl => {
            const match = keyFilter === 'all' || rowEl.dataset.tags.split(' ').includes(keyFilter);
            rowEl.classList.toggle('hidden', !match);
            if (match) shown++;
        });
        document.querySelectorAll('#key-filters button').forEach(chip => chip.setAttribute('aria-checked', String(chip.dataset.filter === keyFilter)));
        const note = $('key-filter-note');
        note.textContent = keyFilter === 'realtime'
            ? 'Diese Anbieter können live mitschreiben. In Unisono geht das im Diktat bisher mit ElevenLabs, Deepgram und Mistral („Live mitschreiben“ in den Einstellungen der Seite Diktat).'
            : keyFilter === 'eu' ? 'Mistral, Scaleway und OVHcloud verarbeiten die Daten laut ihrer Doku in der EU. Bei den Anbietern mit „EU-Region“ lässt sich die EU-Adresse in der Zeile einstellen (bei Azure über die Region der Ressource).' : '';
        note.classList.toggle('hidden', !note.textContent);
        $('key-filter-count').textContent = `${shown} Anbieter`;
    }

    function renderKeyFilters() {
        $('key-filters').replaceChildren(...[['all', 'Alle'], ...Object.entries(TAG_LABELS)].map(([id, label]) =>
            h('button', { type: 'button', role: 'radio', 'data-filter': id, 'aria-checked': 'false', text: label,
                onclick: () => { keyFilter = id; applyKeyFilter(); } })));
    }

    function renderKeyCards() {
        const row = id => {
            const meta = keyMeta(id);
            const isEngine = !!S.apis[id];
            const inputId = 'key-' + id;
            const input = h('input', { id: inputId, type: 'password', class: 'input is-mono', autocomplete: 'off', spellcheck: false, placeholder: meta.keyOptional ? 'Key (nur falls nötig)' : 'Key einfügen', value: keys[id] });
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
                const missing = missingSetting(id);
                if (missing && (keys[id] || meta.keyOptional)) return setStatusText('idle', `${missing.label} fehlt`);
                if (meta.keyOptional) return setStatusText(missing ? 'idle' : 'success', missing ? 'Nicht eingerichtet' : 'Eingerichtet');
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

            // Region, endpoint, server address: saved as they change, like the key.
            const settingFields = (meta.settings || []).map(f => {
                const fieldId = `setting-${id}-${f.field}`;
                const value = S.providerSettings.get(id, f.field);
                const control = f.options
                    ? h('select', { id: fieldId, class: 'input' }, ...f.options.map(([v, text]) => h('option', { value: v, text, selected: v === value })))
                    : h('input', { id: fieldId, type: 'url', class: 'input is-mono', autocomplete: 'off', spellcheck: false, placeholder: f.placeholder || '', value });
                control.addEventListener(f.options ? 'change' : 'input', () => {
                    if (!S.providerSettings.set(id, f.field, control.value)) showFeedback('danger', 'Der Browser blockiert das Speichern.');
                    refreshStatus();
                    keysChanged();
                    warn();
                });
                const warning = h('p', { class: 't-small muted hidden' });
                const warn = () => {
                    const insecure = !f.options && /^http:\/\//i.test(control.value.trim()) && !/^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(control.value.trim());
                    warning.textContent = insecure ? 'Achtung: http:// schickt Key und Audio unverschlüsselt. Außerdem blockiert der Browser http-Adressen auf einer https-Seite meist.' : '';
                    warning.classList.toggle('hidden', !insecure);
                };
                warn();
                return h('div', { class: 'field key-setting' },
                    h('label', { for: fieldId, text: f.label }), control,
                    f.note ? h('p', { class: 't-small muted', text: f.note }) : null, warning);
            });

            const test = async () => {
                save({ quiet: true });
                const missing = missingSetting(id);
                if (missing) return showFeedback('danger', `Bitte zuerst „${missing.label}“ eintragen.`);
                if (!keys[id] && !meta.keyOptional) return showFeedback('danger', 'Bitte zuerst einen Key eintragen.');
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

            return h('div', { class: 'key-row', 'data-tags': providerTags(id).join(' ') },
                h('div', { class: 'key-provider' },
                    isEngine ? dot(id) : null,
                    h('div', { class: 'min-w-0' },
                        h('h3', { class: 'key-name' }, meta.label, S.brandLogo(id)),
                        h('p', { class: 't-small muted', text: meta.description }),
                        h('div', { class: 'tag-row' }, ...providerTags(id).map(tag => h('span', { class: 'tag',
                            text: tag === 'eu' && !EU_IDS.has(id) ? 'EU-Region' : TAG_LABELS[tag] }))))),
                h('div', { class: 'key-input' },
                    h('label', { class: 'visually-hidden', for: inputId, text: `API-Key für ${meta.label}` }),
                    h('div', { class: 'input-wrap' }, input, mask)),
                status,
                h('div', { class: 'key-actions' },
                    h('button', { type: 'button', class: 'btn-secondary is-small', onclick: test }, 'Prüfen'),
                    removeBtn),
                h('div', { class: 'key-more' },
                    settingFields.length ? h('div', { class: 'key-settings' }, ...settingFields) : null,
                    feedback, keyGuide(meta)));
        };
        $('key-cards').replaceChildren(...[...Object.keys(S.apis).filter(id => !S.apis[id].keyId), ...Object.keys(LLM_KEYS)].map(row));
        renderKeyFilters();
        applyKeyFilter();
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
        try {
            const { url, headers } = meta.test(key);
            const res = await fetch(url, { headers });
            if (res.ok) return { ok: true, message: 'Key gültig – Anfragen direkt aus dem Browser funktionieren.' };
            if (res.status === 401 || res.status === 403) return { ok: false, message: `Key ungültig oder ohne Berechtigung (HTTP ${res.status}).` };
            return { ok: false, message: `Der Anbieter antwortet mit HTTP ${res.status}. Bitte später erneut prüfen.` };
        } catch (_) {
            if (meta.keyOptional) return { ok: false, message: 'Der Server antwortet nicht. Läuft er, stimmt die Adresse, und lässt er Anfragen von dieser Seite zu (CORS)?' };
            return {
                ok: false,
                message: 'Anfrage wurde blockiert. Entweder fehlt die Internetverbindung, oder der Anbieter lässt keine Anfragen direkt aus dem Browser zu (CORS) – dann funktioniert er in Unisono nicht.'
            };
        }
    }

    function clearKeys() {
        if (!confirm('Alle gespeicherten API-Keys und Anbieter-Einstellungen (Region, Adressen) aus diesem Browser löschen?')) return;
        for (const id of allKeyIds()) storeKey(id, '');
        S.providerSettings.clear();
        renderKeyCards();
        keysChanged();
        setStatus('Alle API-Keys gelöscht.', 'success');
    }

    // --- Engine selection: a drop-down with the engines that have a key (like on the Diktat page) ---
    function renderProviderCards() {
        const withKey = engineIdsWithKey();
        const select = $('engine-select');
        select.replaceChildren(...(withKey.length
            ? withKey.map(id => h('option', { value: id, text: shortLabel(S.apis[id]) }))
            : [h('option', { value: '', text: 'Zuerst einen API-Key eintragen' })]));
        select.disabled = !withKey.length;
        if (withKey.length) select.value = selectedProvider;

        const api = S.apis[selectedProvider];
        const vocab = api.vocabularySupport?.($('model-select').value || api.models[0].id);
        const notes = [api.description];
        if (!vocab) notes.push('Fachbegriffe nur teilweise.');
        if (!S.canDiarize(selectedProvider, $('model-select').value)) notes.push(`${shortLabel(api)} trennt mit diesem Modell keine Sprecher.`);
        $('provider-info').textContent = notes.join(' ');
        const missing = !hasEngineKey(selectedProvider);
        $('provider-key-note').textContent = missing ? 'API-Key eintragen' : '';
        $('provider-key-note').classList.toggle('hidden', !missing);
    }

    // The engine of the file page: the wanted one if it has a key, else the first with a key.
    function selectProvider(id, { keepModel = false } = {}) {
        const withKey = engineIdsWithKey();
        selectedProvider = S.apis[id] && hasEngineKey(id) ? id : (withKey[0] || (S.apis.gladia ? 'gladia' : engineIds()[0]));
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
        selectProvider(values.provider || values['provider-select']);
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
        const diarizes = S.canDiarize(selectedProvider, $('model-select').value);
        $('diarize').disabled = !diarizes;
        $('speaker-options').classList.toggle('hidden', !$('diarize').checked || !diarizes);
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
        $('start-hint').textContent = !currentFile
            ? 'Zuerst eine Datei wählen oder aufnehmen.'
            : !hasEngineKey(selectedProvider)
                ? 'Zuerst unter „API-Keys“ einen Key eintragen.'
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
        const fitting = engineIdsWithKey().filter(id => id !== providerId && !limitProblems(id).length);
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
        S.recorder.fileChanged(file);
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
        S.recorder.fileChanged(null);
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

    // No connection: the file waits in the archive's queue and is transcribed once the browser is online.
    async function queueForLater(file, provider, model) {
        const diarize = $('diarize').checked && S.canDiarize(provider, model);
        try {
            await S.archive.enqueue(file, { provider, model, language: $('language-select').value, diarize, speakers: diarize ? getSpeakerCount() : null });
            S.recorder.markUsed(file);
            setStatus(`Keine Verbindung: „${file.name}“ wartet im Archiv und wird automatisch transkribiert, sobald wieder Netz da ist.`, 'success');
        } catch (err) {
            showError('Speichern für später fehlgeschlagen', err);
        }
    }

    async function startTranscription() {
        if (!currentFile || running) return;
        const provider = selectedProvider;
        const file = currentFile;
        const model = $('model-select').value;
        if (!navigator.onLine && S.archive.isAvailable()) return queueForLater(file, provider, model);
        if (S.state.get().segments.length && !confirm('Das aktuelle Transkript wird ersetzt. Es bleibt im Archiv. Fortfahren?')) return;

        running = new AbortController();
        hideStatus();
        S.progress.begin({ file, provider, model, duration: currentDuration, cancel: () => running?.abort() });

        try {
            await waitForDuration();
            const limitMsg = limitMessage(provider);
            if (limitMsg) throw new Error(limitMsg);

            const diarize = $('diarize').checked && S.canDiarize(provider, model);
            const { terms: vocabulary } = S.vocabulary.prepare(S.vocabulary.transcriptionTerms(), vocabularySupport());
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
            const project = S.people.current();
            S.state.setTranscript({ raw, segments, provider, fileName: file.name, markers: file.unisonoMarkers, project: project && { id: project.id, name: project.name } });
            // A meeting recording knows when the own microphone was louder than the meeting: that speaker is "Ich".
            const self = file.unisonoMeeting && S.protocolCore.selfSpeaker(S.state.get().segments, file.unisonoMeeting);
            if (self) S.state.renameSpeaker(self, 'Ich');
            S.archive.startNew();
            S.recorder.markUsed(file);
            S.progress.end();
            switchView('transcript');
            setStatus(`Transkription abgeschlossen (${S.format.clock((Date.now() - startedAt) / 1000)}).`, 'success');
        } catch (err) {
            S.progress.end();
            if (err?.name === 'AbortError') setStatus('Transkription abgebrochen. Beim Anbieter bereits hochgeladene Daten löscht er nach seinen eigenen Regeln.', 'error');
            // An own server that does not answer is no missing connection; waiting for "online" would not help.
            else if (S.archiveCore.isNetworkError(err) && S.archive.isAvailable() && !S.apis[provider].keyOptional) await queueForLater(file, provider, model);
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
        if (S.state.get().segments.length && !confirm('Das aktuelle Transkript wird ersetzt. Es bleibt im Archiv. Fortfahren?')) return;
        try {
            const data = JSON.parse(await file.text());
            S.state.loadProject(data);
            S.summary.setText(data.summary);
            S.archive.startNew();
            const audioHint = data.fileName && !currentFile ? ` Für den Player die Audiodatei „${data.fileName}“ laden.` : '';
            switchView('transcript');
            setStatus(`Projekt geöffnet: ${S.state.get().segments.length} Abschnitte.${audioHint}`, 'success');
        } catch (err) {
            setStatus(err instanceof SyntaxError ? 'Die Datei ist kein gültiges JSON.' : err.message, 'error');
        }
    }

    // --- Meeting recording: an optional module, loaded on first use ---
    const MEETING_KEY = 'unisono_module_meeting';
    function setupMeetingModule() {
        let on = false;
        try { on = localStorage.getItem(MEETING_KEY) === '1'; } catch (_) {}
        const show = () => $('meeting-card').classList.toggle('hidden', !on);
        $('module-meeting').checked = on;
        $('module-meeting').addEventListener('change', e => {
            on = e.target.checked;
            try { if (on) localStorage.setItem(MEETING_KEY, '1'); else localStorage.removeItem(MEETING_KEY); } catch (_) {}
            show();
            if (on) setStatus('Meeting-Aufnahme eingeschaltet. Du findest sie auf der Seite „Aufnahme“.', 'success');
        });
        $('meeting-open').addEventListener('click', loadMeeting);
        show();
    }

    let meetingLoad = null;
    async function loadMeeting() {
        meetingLoad ||= new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'js/meeting.js';
            script.onload = resolve;
            script.onerror = () => { meetingLoad = null; reject(new Error('Das Modul ließ sich nicht laden.')); };
            document.head.append(script);
        });
        try {
            await meetingLoad;
            S.meeting.open($('meeting-body'));
        } catch (err) {
            showError('Meeting-Aufnahme', err);
        }
    }

    // --- Init ---
    function init() {
        S.ui = { setStatus, hideStatus, showError, copy, getKey, hasKey: isConfigured };
        S.app = { hasFile: () => !!currentFile, getFile: () => currentFile, loadFile: handleFile, switchView, openSettings: tab => S.settings.open(tab) };

        refreshLlmKeys();
        loadKeys();
        renderKeyCards();
        renderKeyStatus();
        S.vocabulary.init();
        S.vocabulary.onChange(updateHint);
        S.settings.init({
            keyCount: () => ({ saved: allKeyIds().filter(isConfigured).length, total: allKeyIds().length })
        });
        loadConfig();
        CONFIG_FIELDS.forEach(id => $(id).addEventListener('change', () => { renderProviderCards(); updateHint(); saveConfig(); }));
        $('engine-select').addEventListener('change', e => selectProvider(e.target.value));
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

        S.player.init();
        S.editor.init({
            list: $('segment-list'),
            speakers: $('speaker-panel'),
            audio: $('audio-player'),
            follow: $('follow-playback')
        });
        S.markers.init();
        S.search.init();
        S.people.init();
        S.summary.init();
        S.tasks.init();
        setupMeetingModule();
        S.dictation.init();
        S.dictationMini.init();
        const showLlmLogo = () => $('llm-logo').replaceChildren(...[S.brandLogo($('llm-provider').value)].filter(Boolean));
        $('llm-provider').addEventListener('change', showLlmLogo);
        showLlmLogo();
        S.state.subscribe(type => { if (type !== 'text' && type !== 'tasks') updateTranscriptView(); });

        const firstVisit = !allKeyIds().some(isConfigured);
        const restored = S.state.restore();
        S.archive.init();
        updateTranscriptView();
        if (firstVisit) {
            switchView('keys');
            setStatus('Willkommen. Trage zuerst den API-Key für mindestens eine Engine ein.', 'success');
        } else {
            // On phones and tablets Unisono is mostly used to record on site.
            const touch = window.matchMedia?.('(pointer: coarse)').matches;
            switchView(touch ? 'record' : 'start');
            if (restored) {
                const name = S.state.get().fileName;
                setStatus(`Letztes Transkript wiederhergestellt${name ? ` (${name})` : ''}. Du findest es unter „Transkript“.`, 'success');
            }
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})(window.Unisono);

/* App wiring: API keys, configuration, file handling, transcription run, status and export buttons. */
window.Scribe = window.Scribe || {};
(function (S) {
    const $ = id => document.getElementById(id);

    // Provider id → input field. Stored in localStorage as scribe_key_<id>.
    const STORED_FIELDS = {
        gladia: 'key-gladia', elevenlabs: 'key-elevenlabs', assembly: 'key-assembly',
        deepgram: 'key-deepgram', deepgram_proxy: 'deepgram-proxy',
        anthropic: 'key-anthropic', openai: 'key-openai'
    };
    const KEY_LABELS = {
        gladia: 'Gladia', elevenlabs: 'ElevenLabs', assembly: 'AssemblyAI', deepgram: 'Deepgram',
        anthropic: 'Anthropic', openai: 'OpenAI'
    };

    let currentFile = null;

    // --- Status & helpers shared with other modules ---
    function setStatus(text, type = 'info') {
        const banner = $('status-banner');
        const styles = {
            info: ['status-info', 'fa-solid fa-circle-notch fa-spin'],
            success: ['status-success', 'fa-solid fa-circle-check'],
            error: ['status-error', 'fa-solid fa-triangle-exclamation']
        };
        const [cls, icon] = styles[type];
        banner.className = 'status-banner ' + cls;
        $('status-icon').className = icon;
        $('status-text').textContent = text;
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

    // --- Keys (localStorage may be unavailable, e.g. in private mode) ---
    function loadKeys() {
        for (const [name, field] of Object.entries(STORED_FIELDS)) {
            try { $(field).value = localStorage.getItem('scribe_key_' + name) || ''; } catch (_) {}
        }
        // First visit: show the key form instead of hiding it in the collapsed panel.
        $('keys-panel').open = !Object.values(STORED_FIELDS).some(field => $(field).value);
    }

    function saveKeys() {
        try {
            for (const [name, field] of Object.entries(STORED_FIELDS)) {
                localStorage.setItem('scribe_key_' + name, $(field).value.trim());
            }
            setStatus('API-Schlüssel lokal in diesem Browser gespeichert.', 'success');
        } catch (_) {
            setStatus('Speichern nicht möglich (Browser blockiert localStorage). Keys gelten nur für diese Sitzung.', 'error');
        }
    }

    function clearKeys() {
        for (const [name, field] of Object.entries(STORED_FIELDS)) {
            $(field).value = '';
            try { localStorage.removeItem('scribe_key_' + name); } catch (_) {}
        }
        setStatus('Gespeicherte API-Schlüssel gelöscht.', 'success');
    }

    function getKey(name) {
        const key = $(STORED_FIELDS[name]).value.trim();
        if (!key) throw new Error(`Bitte ${KEY_LABELS[name]} API-Key eingeben.`);
        return key;
    }

    // --- Configuration ---
    function populateProviders() {
        const select = $('provider-select');
        for (const [id, api] of Object.entries(S.apis)) {
            select.append(Object.assign(document.createElement('option'), { value: id, textContent: api.label }));
        }
        updateModels();
    }

    function updateModels() {
        const api = S.apis[$('provider-select').value];
        $('model-select').replaceChildren(...api.models.map(m =>
            Object.assign(document.createElement('option'), { value: m.id, textContent: m.name })));
        updateHint();
    }

    function updateHint() {
        $('speaker-options').classList.toggle('hidden', !$('diarize').checked);
        const hints = [];
        if ($('model-select').value === 'solaria-3' && $('language-select').value === 'auto') {
            hints.push('Solaria 3 braucht eine feste Sprache. Bitte eine Sprache wählen oder auf Solaria 1 wechseln.');
        }
        if (S.apis[$('provider-select').value].needsProxy) {
            hints.push('Deepgram erlaubt keine direkten Browser-Anfragen. Trage unter „API-Schlüssel“ eine Proxy-URL ein (siehe README).');
        }
        $('model-hint').textContent = hints.join(' ');
        $('model-hint').classList.toggle('hidden', !hints.length);
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
        $('file-input').addEventListener('change', e => handleFile(e.target.files[0]));
    }

    function handleFile(file) {
        if (!file) return;
        currentFile = file;
        $('file-name').textContent = file.name;
        $('file-size').textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
        $('file-info').classList.remove('hidden');
        $('start-btn').disabled = false;

        const player = $('audio-player');
        if (player.src) URL.revokeObjectURL(player.src);
        player.src = URL.createObjectURL(file);
        $('player-bar').classList.remove('hidden');
    }

    // --- Transcription ---
    async function startTranscription() {
        if (!currentFile) return;
        if (S.state.get().segments.length && !confirm('Das aktuelle Transkript inklusive deiner Änderungen wird ersetzt. Fortfahren?')) return;

        const provider = $('provider-select').value;
        const diarize = $('diarize').checked;
        $('start-btn').disabled = true;
        const startedAt = Date.now();

        try {
            const { raw, segments } = await S.apis[provider].transcribe(currentFile, {
                key: getKey(provider),
                model: $('model-select').value,
                language: $('language-select').value,
                diarize,
                speakers: diarize ? getSpeakerCount() : null,
                proxy: $('deepgram-proxy').value.trim(),
                onStatus: text => setStatus(text)
            });
            S.state.setTranscript({ raw, segments, provider, fileName: currentFile.name });
            setStatus(`Transkription abgeschlossen (${Math.round((Date.now() - startedAt) / 1000)} s).`, 'success');
        } catch (err) {
            showError('Fehler', err);
        } finally {
            $('start-btn').disabled = false;
        }
    }

    function updateTranscriptActions() {
        const has = S.state.get().segments.length > 0;
        document.querySelectorAll('[data-needs-transcript]').forEach(b => { b.disabled = !has; });
    }

    // --- Init ---
    function init() {
        S.ui = { setStatus, showError, copy, getKey };

        loadKeys();
        populateProviders();
        setupDropZone();

        $('save-keys').addEventListener('click', saveKeys);
        $('clear-keys').addEventListener('click', clearKeys);
        $('provider-select').addEventListener('change', updateModels);
        $('model-select').addEventListener('change', updateHint);
        $('language-select').addEventListener('change', updateHint);
        $('diarize').addEventListener('change', updateHint);
        $('start-btn').addEventListener('click', startTranscription);

        document.querySelectorAll('[data-export]').forEach(b => b.addEventListener('click', () => S.export.exportAs(b.dataset.export)));
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
        S.state.subscribe(updateTranscriptActions);

        if (S.state.restore()) {
            const name = S.state.get().fileName;
            setStatus(`Letztes Transkript wiederhergestellt${name ? ` (${name})` : ''}. Audiodatei erneut laden, um den Player zu nutzen.`, 'success');
        }
        updateTranscriptActions();
    }

    document.addEventListener('DOMContentLoaded', init);
})(window.Scribe);

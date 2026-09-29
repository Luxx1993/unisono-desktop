/*
 * Settings pages: "Einstellungen" (appearance, data & privacy) and the jump targets of
 * open(tab) for the API keys and vocabulary pages.
 *
 * The key list and the vocabulary editor are filled by app.js and vocabulary.js (they only
 * look up their element IDs); this module owns the appearance switch and the data panel.
 */
window.Unisono = window.Unisono || {};

(function (S) {
    const $ = id => document.getElementById(id);
    // Former dialog tabs → pages
    const PAGES = { keys: 'keys', vocab: 'vocab', appearance: 'settings', data: 'settings', settings: 'settings' };
    const MODE_LABELS = { light: 'Hell', dark: 'Dunkel', system: 'Wie System' };

    let options = {};

    function open(tab = 'keys') {
        S.app.switchView(PAGES[tab] || 'keys');
    }

    function isShown() {
        return !$('view-settings').classList.contains('hidden');
    }

    // --- Appearance ---
    function renderAppearance() {
        const { mode } = S.appearance.get();
        $('mode-options').replaceChildren(...S.appearance.MODES.map(id => {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', String(id === mode));
            button.textContent = MODE_LABELS[id];
            button.addEventListener('click', () => S.appearance.setMode(id));
            return button;
        }));
    }

    // --- Data & privacy ---
    async function refreshData() {
        const { saved, total } = options.keyCount();
        $('data-keys-info').textContent = saved
            ? `${saved} von ${total} Keys in diesem Browser gespeichert.`
            : 'Keine Keys gespeichert.';
        $('clear-keys').disabled = !saved;

        const { segments, fileName } = S.state.get();
        $('data-session-info').textContent = segments.length
            ? `${fileName || 'Ohne Namen'} · ${segments.length} Abschnitt${segments.length === 1 ? '' : 'e'}. Wird beim nächsten Öffnen wiederhergestellt.`
            : 'Kein Transkript gespeichert.';
        $('clear-session').disabled = !segments.length;

        if (S.recorder.isActive()) {
            $('data-recording-info').textContent = 'Gerade läuft eine Aufnahme – die Sicherung wird gebraucht.';
            $('clear-recordings').disabled = true;
            return;
        }
        const backup = await S.recordingBackup.find();
        $('data-recording-info').textContent = backup
            ? `Eine unterbrochene Aufnahme (${sizeLabel(backup.blob.size)}) ist gesichert.`
            : 'Keine Sicherung vorhanden. Während einer Aufnahme wird sie laufend angelegt und nach dem Stoppen gelöscht.';
        $('clear-recordings').disabled = !backup;
    }

    function sizeLabel(bytes) {
        const kb = bytes / 1024;
        return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1).replace('.', ',')} MB`;
    }

    function clearSession() {
        if (!confirm('Das gespeicherte Transkript mit allen Änderungen löschen? Exportierte Dateien bleiben erhalten.')) return;
        S.state.clear();
        S.ui.setStatus('Gespeichertes Transkript gelöscht.', 'success');
        refreshData();
    }

    async function clearRecordings() {
        if (!confirm('Die Sicherung der unterbrochenen Aufnahme endgültig löschen?')) return;
        await S.recorder.discardBackup();
        S.ui.setStatus('Aufnahme-Sicherung gelöscht.', 'success');
        refreshData();
    }

    async function resetAll() {
        if (S.recorder.isActive()) return S.ui.setStatus('Bitte zuerst die laufende Aufnahme beenden.', 'error');
        if (!confirm('Wirklich alles löschen – Keys, Transkript, Aufnahme-Sicherung, Fachbegriffe und Einstellungen?')) return;
        S.state.clear();
        $('vocab-text').value = '';
        await S.recorder.discardBackup();
        try {
            Object.keys(localStorage).filter(k => k.startsWith('unisono_')).forEach(k => localStorage.removeItem(k));
        } catch (_) {}
        location.reload();
    }

    function init(opts) {
        options = opts;
        $('clear-session').addEventListener('click', clearSession);
        $('clear-recordings').addEventListener('click', clearRecordings);
        $('reset-all').addEventListener('click', resetAll);

        renderAppearance();
        S.appearance.onChange(renderAppearance);
    }

    S.settings = { init, open, refresh: () => isShown() && refreshData(), refreshData };
})(window.Unisono);

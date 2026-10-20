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

        const archived = S.archive?.count() || 0;
        const queued = S.archive?.pendingCount() || 0;
        $('data-archive-info').textContent = S.archive && !S.archive.isAvailable()
            ? 'Der Browser erlaubt hier keinen Speicher (z. B. privates Fenster). Das Archiv ist aus.'
            : (archived ? `${archived} Transkript${archived === 1 ? '' : 'e'} im Archiv.` : 'Das Archiv ist leer.')
              + (queued ? ` ${queued} Aufnahme${queued === 1 ? '' : 'n'} warte${queued === 1 ? 't' : 'n'} auf die Transkription.` : '');
        $('clear-archive').disabled = !archived;

        const dictations = S.dictation.historyCount();
        $('data-dictation-info').textContent = dictations
            ? `${dictations} Diktat${dictations === 1 ? '' : 'e'} in diesem Browser gespeichert.`
            : 'Kein Verlauf gespeichert.';
        $('clear-dictation').disabled = !dictations;

        const { projects, people } = S.people.count();
        $('data-projects-info').textContent = projects
            ? `${projects} Projekt${projects === 1 ? '' : 'e'} mit ${people} Person${people === 1 ? '' : 'en'}.`
            : 'Keine Projekte angelegt.';
        $('clear-projects').disabled = !projects;

        const counted = S.dictation.statsCount();
        $('data-stats-info').textContent = counted
            ? `${counted} Eintr${counted === 1 ? 'ag' : 'äge'} in der Statistik.`
            : 'Keine Statistik gespeichert.';
        $('clear-stats').disabled = !counted;

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

    function clearDictation() {
        if (!confirm('Den Verlauf der Diktate in diesem Browser löschen?')) return;
        S.dictation.clearHistory();
        S.ui.setStatus('Diktat-Verlauf gelöscht.', 'success');
        refreshData();
    }

    function clearStats() {
        if (!confirm('Die Statistik der Diktate zurücksetzen?')) return;
        S.dictation.clearStats();
        S.ui.setStatus('Diktat-Statistik gelöscht.', 'success');
        refreshData();
    }

    async function clearRecordings() {
        if (!confirm('Die Sicherung der unterbrochenen Aufnahme endgültig löschen?')) return;
        await S.recorder.discardBackup();
        await new Promise(resolve => { try { const r = indexedDB.deleteDatabase('unisono-archive'); r.onsuccess = r.onerror = r.onblocked = resolve; } catch (_) { resolve(); } });
        S.ui.setStatus('Aufnahme-Sicherung gelöscht.', 'success');
        refreshData();
    }

    async function resetAll() {
        if (S.recorder.isActive() || S.dictation.isActive()) return S.ui.setStatus('Bitte zuerst die laufende Aufnahme beenden.', 'error');
        if (!confirm('Wirklich alles löschen – Keys, Transkript, Archiv mit Warteschlange, Projekte, Aufnahme-Sicherung, Fachbegriffe, Ersetzungen, Diktat-Verlauf, Diktat-Statistik und Einstellungen?')) return;
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
        $('clear-dictation').addEventListener('click', clearDictation);
        $('clear-stats').addEventListener('click', clearStats);
        $('clear-recordings').addEventListener('click', clearRecordings);
        $('clear-archive').addEventListener('click', () => S.archive.clearAll());
        $('clear-projects').addEventListener('click', () => {
            if (!confirm('Alle Projekte und Personen aus diesem Browser löschen? Transkripte bleiben erhalten.')) return;
            S.people.clearAll();
            refreshData();
            S.ui.setStatus('Projekte und Personen gelöscht.', 'success');
        });
        $('reset-all').addEventListener('click', resetAll);

        renderAppearance();
        S.appearance.onChange(renderAppearance);
    }

    S.settings = { init, open, refresh: () => isShown() && refreshData(), refreshData };
})(window.Unisono);

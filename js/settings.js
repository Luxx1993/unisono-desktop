/*
 * Settings dialog behind the gear button: API keys, vocabulary, appearance, data & privacy.
 *
 * The key cards and the vocabulary editor are filled by app.js and vocabulary.js (they only
 * look up their element IDs); this module opens and closes the dialog, switches categories,
 * and owns the "Darstellung" and "Daten & Datenschutz" panels.
 */
window.Scribe = window.Scribe || {};

(function (S) {
    const $ = id => document.getElementById(id);
    const TABS = ['keys', 'vocab', 'appearance', 'data'];
    const MODE_LABELS = {
        dark: ['dark_mode', 'Dunkel'],
        light: ['light_mode', 'Hell'],
        system: ['contrast', 'Wie System']
    };

    let dialog;
    let options = {};

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function icon(name) {
        return el('span', 'material-symbols-outlined', name);
    }

    // --- Open / close ---
    function open(tab = 'keys') {
        selectTab(TABS.includes(tab) ? tab : 'keys');
        refreshData();
        if (!dialog.open) {
            dialog.showModal();
            // The dialog sits in the top layer; move the status toast inside so its messages stay visible.
            dialog.append(document.querySelector('.status-dock'));
        }
        // Focus the dialog itself: Esc and Tab work, and no focus ring appears on a button.
        dialog.querySelector('.settings-shell').focus();
    }

    function close() {
        if (dialog.open) dialog.close();
    }

    function onClosed() {
        document.querySelector('main').prepend(document.querySelector('.status-dock'));
        options.onClose?.();
    }

    function selectTab(name) {
        document.querySelectorAll('[data-settings-tab]').forEach(tab => {
            const selected = tab.dataset.settingsTab === name;
            tab.setAttribute('aria-selected', selected);
            tab.tabIndex = selected ? 0 : -1;
            $('settings-' + tab.dataset.settingsTab).classList.toggle('hidden', !selected);
        });
        document.querySelector('.settings-panels').scrollTop = 0;
        if (name === 'data') refreshData();
    }

    // Arrow keys move between categories (tablist pattern).
    function onTabKey(e) {
        const keysNext = ['ArrowDown', 'ArrowRight'];
        const keysPrev = ['ArrowUp', 'ArrowLeft'];
        if (![...keysNext, ...keysPrev, 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const current = TABS.indexOf(e.target.dataset.settingsTab);
        let next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1
            : (current + (keysNext.includes(e.key) ? 1 : -1) + TABS.length) % TABS.length;
        selectTab(TABS[next]);
        $('settings-tab-' + TABS[next]).focus();
    }

    // --- Appearance ---
    function renderAppearance() {
        const { mode, theme, resolved } = S.appearance.get();

        $('mode-options').replaceChildren(...S.appearance.MODES.map(id => {
            const [iconName, label] = MODE_LABELS[id];
            const button = el('button');
            button.type = 'button';
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-checked', id === mode);
            button.append(icon(iconName), label);
            button.addEventListener('click', () => S.appearance.setMode(id));
            return button;
        }));

        $('theme-options').replaceChildren(...S.appearance.THEMES.map(t => {
            const [bg, surface, accent] = t.swatch[resolved];
            const preview = el('span', 'theme-preview');
            preview.style.background = bg;
            const panel = el('span', 'tp-panel');
            panel.style.background = surface;
            const line1 = el('span', 'tp-line');
            line1.style.cssText = `top:38%;width:32%;background:${accent}`;
            const line2 = el('span', 'tp-line');
            line2.style.cssText = `top:56%;width:22%;background:${accent}`;
            const dot = el('span', 'tp-accent');
            dot.style.background = accent;
            preview.append(panel, line1, line2, dot);

            const name = el('span', 'theme-name');
            name.append(el('strong', '', t.label));
            if (t.id === theme) name.append(icon('check_circle'));

            const card = el('button', 'theme-card');
            card.type = 'button';
            card.setAttribute('role', 'radio');
            card.setAttribute('aria-checked', t.id === theme);
            card.append(preview, name, el('p', '', t.description));
            card.addEventListener('click', () => S.appearance.setTheme(t.id));
            return card;
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
            Object.keys(localStorage).filter(k => k.startsWith('scribe_')).forEach(k => localStorage.removeItem(k));
        } catch (_) {}
        location.reload();
    }

    function init(opts) {
        options = opts;
        dialog = $('settings-dialog');

        document.querySelectorAll('[data-settings]').forEach(button =>
            button.addEventListener('click', () => open(button.dataset.settings)));
        document.querySelectorAll('[data-settings-tab]').forEach(tab => {
            tab.addEventListener('click', () => selectTab(tab.dataset.settingsTab));
            tab.addEventListener('keydown', onTabKey);
        });
        $('settings-close').addEventListener('click', close);
        dialog.addEventListener('close', onClosed);

        // Close on a click on the backdrop – but not when a text selection started inside ends outside.
        let downOnBackdrop = false;
        dialog.addEventListener('pointerdown', e => { downOnBackdrop = e.target === dialog; });
        dialog.addEventListener('click', e => {
            if (downOnBackdrop && e.target === dialog) close();
            downOnBackdrop = false;
        });

        $('clear-session').addEventListener('click', clearSession);
        $('clear-recordings').addEventListener('click', clearRecordings);
        $('reset-all').addEventListener('click', resetAll);

        renderAppearance();
        S.appearance.onChange(renderAppearance);
    }

    S.settings = { init, open, close, refresh: () => dialog?.open && refreshData() };
})(window.Scribe);

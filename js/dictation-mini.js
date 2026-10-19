/*
 * Floating window for the dictation: a small window that stays on top of other programs, with the record
 * button, the style and the result, so you can dictate while another program has the focus.
 *
 * It is a "Document Picture-in-Picture" window (Chrome and Edge from version 116). Firefox and Safari do not
 * have it; there the button is replaced by a note. The page "Diktat" keeps doing the work (recording,
 * transcription, clean-up); this window shows its state and passes the clicks on, see S.dictation.on / down /
 * up / cancel / setStyle.
 *
 * The space bar works while the floating window has the focus (a web page cannot listen to keys while another
 * program is in front, which is why the window exists). The result is copied from this window's own
 * clipboard access: the page behind is not focused, and an unfocused page may not write to the clipboard.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const $ = id => document.getElementById(id);
    const SIZE = { width: 340, height: 440 };
    const NOTE_MS = 9000;

    let pip = null;
    let ui = null;
    let unsubscribe = null;
    let noteTimer = null;

    const supported = () => !!window.documentPictureInPicture?.requestWindow;

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

    const formatTime = seconds => {
        const s = Math.max(0, Math.floor(seconds));
        return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    };

    async function open() {
        if (pip) return pip.close();
        let win;
        try {
            win = await window.documentPictureInPicture.requestWindow(SIZE);
        } catch (err) {
            return S.ui.setStatus('Das schwebende Fenster lässt sich nicht öffnen: ' + err.message, 'error');
        }
        pip = win;
        ui = build(win);
        S.dictation.setCopyHost(win);
        unsubscribe = S.dictation.on(onEvent);
        win.addEventListener('pagehide', teardown);
        render();
        label();
    }

    function teardown() {
        unsubscribe?.();
        S.dictation.setCopyHost(null);
        clearTimeout(noteTimer);
        pip = null;
        ui = null;
        label();
    }

    function label() {
        const button = $('dict-mini-open');
        const text = pip ? 'Schwebendes Fenster schließen' : 'Schwebendes Fenster öffnen';
        button.replaceChildren(S.icon('expand'), text);
    }

    // The window's document: the page's stylesheets and icons, then the controls.
    function build(win) {
        const doc = win.document;
        doc.title = 'Unisono Diktat';
        doc.documentElement.lang = 'de';
        const theme = document.documentElement.getAttribute('data-theme');
        if (theme) doc.documentElement.setAttribute('data-theme', theme);
        for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
            const copy = doc.createElement('link');
            copy.rel = 'stylesheet';
            copy.href = link.href;
            doc.head.append(copy);
        }
        const sprite = document.querySelector('.icon-sprite');
        if (sprite) doc.body.append(sprite.cloneNode(true));
        doc.body.classList.add('mini-body');

        const state = el('span', { class: 't-label' });
        const time = el('span', { class: 't-mono muted', text: '00:00' });
        const levelBar = el('div', { class: 'rec-level-bar' });
        const main = el('button', { type: 'button', class: 'rec-mark-btn mini-main' }, S.icon('mic'), el('span'));
        const cancel = el('button', { type: 'button', class: 'btn-text is-invisible mini-cancel', text: 'Verwerfen', onclick: () => S.dictation.cancel() });
        const select = el('select', { class: 'input', 'aria-label': 'Stil', onchange: e => S.dictation.setStyle(e.target.value) });
        const taskNote = el('p', { class: 't-small muted hidden', text: 'Umformulieren: Text und Anweisung im Hauptfenster.' });
        const note = el('p', { class: 't-small mini-note hidden', role: 'status' });
        const text = el('textarea', { class: 'input is-area mini-text', rows: 3, spellcheck: false, placeholder: 'Hier erscheint das Ergebnis.', 'aria-label': 'Ergebnis' });
        text.addEventListener('input', () => S.dictation.editResult(text.value));
        const copy = el('button', { type: 'button', class: 'btn-primary', onclick: () => copyResult() }, S.icon('copy'), 'Kopieren');

        // Click in "Antippen"; pointer down and up in "Halten".
        main.addEventListener('click', () => { if (S.dictation.getState().mode === 'tap') S.dictation.down(); });
        main.addEventListener('pointerdown', e => {
            if (S.dictation.getState().mode !== 'hold' || e.button > 0) return;
            main.setPointerCapture?.(e.pointerId);
            S.dictation.down();
        });
        ['pointerup', 'pointercancel'].forEach(type => main.addEventListener(type, () => S.dictation.up()));

        const isTarget = t => t === doc.body || t === main;
        doc.addEventListener('keydown', e => S.dictation.keyDown(e, isTarget));
        doc.addEventListener('keyup', e => S.dictation.keyUp(e, isTarget));

        const root = el('div', { class: 'recorder mini' },
            el('div', { class: 'mini-head' }, el('span', { class: 'rec-display-status' }, el('span', { class: 'status-dot rec-dot', 'aria-hidden': 'true' }), state), time),
            el('div', { class: 'rec-level', 'aria-hidden': 'true' }, levelBar),
            main, cancel, select, taskNote, note, text, copy);
        doc.body.append(root);
        return { doc, root, state, time, levelBar, main, cancel, select, taskNote, note, text };
    }

    function render() {
        if (!ui) return;
        const st = S.dictation.getState();
        ui.root.classList.toggle('is-recording', st.phase === 'recording');
        ui.state.textContent = st.stateText;
        ui.main.disabled = st.phase === 'working';
        ui.main.querySelector('span').textContent = st.buttonText;
        S.setIcon(ui.main.querySelector('.icon'), st.phase === 'recording' ? 'stop' : 'mic');
        ui.cancel.classList.toggle('is-invisible', st.phase === 'idle' || st.phase === 'starting');
        ui.cancel.textContent = st.phase === 'working' ? 'Abbrechen' : 'Verwerfen';
        ui.select.replaceChildren(...st.styles.map(s => el('option', { value: s.id, text: s.name })));
        ui.select.value = st.style;
        const reword = st.task === 'reword';
        ui.select.classList.toggle('hidden', reword);
        ui.taskNote.classList.toggle('hidden', !reword);
        showResult(st.result);
    }

    function showResult(result) {
        if (!ui || !result) return;
        if (ui.doc.activeElement !== ui.text && ui.text.value !== result.text) ui.text.value = result.text;
    }

    function onEvent(type, data) {
        if (!ui) return;
        if (type === 'tick') {
            ui.time.textContent = formatTime(data.seconds);
            ui.levelBar.style.transform = `scaleX(${Math.min(1, data.level * 4).toFixed(3)})`;
            return;
        }
        if (type === 'result') return showResult(data);
        if (type === 'notice') return showNote(data.text, data.type);
        render();
        if (type === 'phase' && data.phase === 'idle') {
            ui.time.textContent = '00:00';
            ui.levelBar.style.transform = 'scaleX(0)';
        }
    }

    function showNote(text, type) {
        if (!ui) return;
        ui.note.textContent = text;
        ui.note.dataset.type = type;
        ui.note.classList.remove('hidden');
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => ui?.note.classList.add('hidden'), NOTE_MS);
    }

    async function copyResult() {
        if (!ui || !ui.text.value) return;
        try {
            await pip.navigator.clipboard.writeText(ui.text.value);
            showNote('In die Zwischenablage kopiert.', 'success');
        } catch (_) {
            ui.text.select();
            const ok = ui.doc.execCommand?.('copy');
            showNote(ok ? 'In die Zwischenablage kopiert.' : 'Kopieren wurde vom Browser blockiert.', ok ? 'success' : 'error');
        }
    }

    function init() {
        const button = $('dict-mini-open');
        if (supported()) {
            button.classList.remove('hidden');
            button.addEventListener('click', open);
            label();
        } else {
            $('dict-mini-note').textContent = 'Das schwebende Fenster gibt es in Chrome und Edge (ab Version 116). In diesem Browser bleibt das Diktat in diesem Tab.';
            $('dict-mini-note').classList.remove('hidden');
        }
    }

    S.dictationMini = { init, isOpen: () => !!pip, supported };
})(window.Unisono);

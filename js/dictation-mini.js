/*
 * Floating window for the dictation, in the look and with the logic of the floating button of the Android app
 * "diktat": a round button, the Wolke (glass sphere with smoke) or the Welle (the app icon as a wave around a
 * globe), that sits on top of other programs.
 *
 * - Tap the button to start and stop (or hold it, as chosen on the page "Diktat"). While recording it
 *   reacts to the voice, while the text is on its way it shows the working animation, and when done it tells
 *   so (green or red tint for the Wolke, a pulse or a shake for the Welle). The result is copied.
 * - Long press (in "Halten": a short tap) opens the menu with the styles, as the app's prompt menu does. For
 *   "Umformulieren" the menu offers the instructions instead, and the two tasks can be switched there.
 * - While recording, a round button next to the sphere discards the take.
 * - When unused for a few seconds the sphere shrinks and turns see-through, as in the app. It wakes on touch.
 *
 * It is a "Document Picture-in-Picture" window (Chrome and Edge from version 116). Firefox and Safari do not
 * have it; there the button is replaced by a note. The page "Diktat" keeps doing the work (recording,
 * transcription, clean-up); this window shows its state and passes the clicks on, see S.dictation.on / down /
 * up / cancel / setStyle / setTask / reword.
 *
 * The space bar and Esc work while the floating window has the focus (a web page cannot listen to keys while
 * another program is in front, which is why the window exists). The result is copied from this window's own
 * clipboard access: the page behind is not focused, and an unfocused page may not write to the clipboard.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const $ = id => document.getElementById(id);
    const SIZE = { width: 270, height: 360 };
    const ORB_SIZE = 168;
    const NOTE_MS = 9000;
    const DIM_AFTER_MS = 3500;       // AUTO_DIM_DELAY_MS of the app
    const LONG_PRESS_MS = 450;
    const HOLD_START_MS = 150;       // HOLD_START_MS of the app: a tap never opens the microphone

    let pip = null;
    let ui = null;
    let orb = null;
    let preview = null;
    let unsubscribe = null;
    let noteTimer = null;
    let dimTimer = null;
    let copyTimer = null;

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

    const orbPhase = st => st.phase === 'recording' ? 'recording' : st.phase === 'working' ? 'working' : 'idle';

    // --- Opening and closing ----------------------------------------------------------------------------
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
        clearTimeout(dimTimer);
        clearTimeout(copyTimer);
        orb?.destroy();
        orb = null;
        pip = null;
        ui = null;
        label();
    }

    function label() {
        const button = $('dict-mini-open');
        button.replaceChildren(S.icon('expand'), pip ? 'Schwebendes Fenster schließen' : 'Schwebendes Fenster öffnen');
    }

    // --- The window's document ---------------------------------------------------------------------------
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

        const orbHost = el('div', { class: 'mini-orb', role: 'button', tabindex: 0, 'aria-label': 'Diktat' });
        const cancel = el('button', { type: 'button', class: 'mini-cancel is-hidden', 'aria-label': 'Verwerfen', title: 'Verwerfen', onclick: () => S.dictation.cancel() }, S.icon('close'));
        const stage = el('div', { class: 'mini-stage' }, orbHost, cancel);
        const state = el('p', { class: 't-label mini-state' });
        const styleLine = el('p', { class: 't-small muted mini-style' });
        const note = el('p', { class: 't-small mini-note hidden', role: 'status' });
        const live = el('p', { class: 't-small mini-live hidden', 'aria-live': 'polite' });
        const resultText = el('p', { class: 't-small mini-result-text' });
        const copyBtn = el('button', { type: 'button', class: 'icon-btn is-small', 'aria-label': 'Kopieren', title: 'Kopieren', onclick: () => copyResult() }, S.icon('copy'));
        const result = el('div', { class: 'mini-result hidden' }, resultText, copyBtn);
        const menu = el('div', { class: 'mini-menu hidden', role: 'menu' });
        const root = el('div', { class: 'mini-bubble' }, stage, state, styleLine, live, note, result, menu);
        doc.body.append(root);

        const u = { doc, win, root, stage, orbHost, cancel, state, styleLine, live, note, result, resultText, copyBtn, menu, held: false };
        wireOrb(u);

        const isTarget = t => t === doc.body || t === orbHost;
        doc.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !menu.classList.contains('hidden')) { e.preventDefault(); closeMenu(); return; }
            if (S.dictation.keyDown(e, isTarget)) wake();
        });
        doc.addEventListener('keyup', e => { S.dictation.keyUp(e, isTarget); });
        doc.addEventListener('pointerdown', e => { if (!menu.classList.contains('hidden') && !menu.contains(e.target)) closeMenu(); wake(); });
        doc.addEventListener('pointermove', wake);
        doc.addEventListener('pointerenter', wake);
        return u;
    }

    // The sphere: tap or hold, long press for the menu.
    function wireOrb(u) {
        let pressTimer = null;
        let consumed = false;     // the press already did its job (menu opened, recording stopped, started by holding)
        let started = false;      // hold mode: this press started the recording

        u.orbHost.addEventListener('pointerdown', e => {
            if (e.button > 0) return;
            u.orbHost.setPointerCapture?.(e.pointerId);
            consumed = false;
            started = false;
            wake();
            const st = S.dictation.getState();
            if (st.phase === 'working') { consumed = true; return; }
            if (st.phase === 'recording' || st.phase === 'starting') {
                consumed = true;
                if (st.mode === 'tap') S.dictation.down();
                return;
            }
            if (st.mode === 'tap') {
                pressTimer = u.win.setTimeout(() => { consumed = true; openMenu(); }, LONG_PRESS_MS);
            } else {
                pressTimer = u.win.setTimeout(() => { started = true; S.dictation.down(); }, HOLD_START_MS);
            }
        });
        const release = e => {
            u.win.clearTimeout(pressTimer);
            const st = S.dictation.getState();
            if (st.mode === 'hold') {
                if (started) S.dictation.up();
                else if (!consumed && e.type === 'pointerup') openMenu();     // a short tap in hold mode: the menu
                return;
            }
            if (!consumed && e.type === 'pointerup') S.dictation.down();       // a tap in tap mode: start
        };
        u.orbHost.addEventListener('pointerup', release);
        u.orbHost.addEventListener('pointercancel', release);
        u.orbHost.addEventListener('contextmenu', e => e.preventDefault());
        u.orbHost.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); S.dictation.down(); } });
    }

    // --- The look: sphere, texts, state -------------------------------------------------------------------
    function makeOrb(st) {
        orb?.destroy();
        const ink = ui.win.getComputedStyle(ui.doc.body).color;
        orb = S.orbs.create(st.skin, ui.win, { size: ORB_SIZE, palette: st.palette, ink });
        ui.orbHost.replaceChildren(orb.el);
        ui.orbHost.dataset.skin = st.skin;
        ui.cancel.style.background = st.skin === 'cloud' ? S.orbs.surfaceGradient(st.palette) : '';
        orb.setPhase(orbPhase(st));
    }

    function render() {
        if (!ui) return;
        const st = S.dictation.getState();
        if (!orb || ui.orbHost.dataset.skin !== st.skin) makeOrb(st);
        else orb.setPalette(st.palette);
        ui.cancel.style.background = st.skin === 'cloud' ? S.orbs.surfaceGradient(st.palette) : '';
        orb.setPhase(orbPhase(st));
        ui.root.classList.toggle('is-recording', st.phase === 'recording');
        ui.state.textContent = st.stateText;
        ui.cancel.classList.toggle('is-hidden', st.phase !== 'recording' && st.phase !== 'working');
        ui.cancel.setAttribute('aria-label', st.phase === 'working' ? 'Abbrechen' : 'Verwerfen');
        ui.orbHost.setAttribute('aria-label', st.buttonText);
        ui.styleLine.textContent = st.task === 'reword'
            ? 'Umformulieren: Anweisung sprechen'
            : `Stil: ${st.styleName} · lang drücken für das Menü`;
        showResult(st.result);
        if (st.phase === 'idle') ui.live.classList.add('hidden');
        if (st.phase === 'idle') scheduleDim(); else wake();
    }

    function showResult(result) {
        if (!ui) return;
        ui.result.classList.toggle('hidden', !result || !result.text);
        if (result) ui.resultText.textContent = result.text;
    }

    function onEvent(type, data) {
        if (!ui) return;
        if (type === 'tick') {
            orb?.setLevel(Math.min(1, data.level * 4));
            ui.state.textContent = `${S.dictation.getState().stateText} · ${formatTime(data.seconds)}`;
            return;
        }
        if (type === 'result') return showResult(data);
        // Live transcription: the end of the text so far, while speaking.
        if (type === 'live') {
            ui.live.textContent = data.text.length > 180 ? '… ' + data.text.slice(-180).replace(/^\S*\s/, '') : data.text;
            ui.live.classList.toggle('hidden', !data.text);
            return;
        }
        if (type === 'notice') return showNote(data.text, data.type);
        if (type === 'done') {
            wake();
            orb?.mark(data.ok ? 'success' : 'error');
            return;
        }
        render();
    }

    function showNote(text, type) {
        if (!ui) return;
        ui.note.textContent = text;
        ui.note.dataset.type = type;
        ui.note.classList.remove('hidden');
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => ui?.note.classList.add('hidden'), NOTE_MS);
    }

    // --- Dimming when unused ------------------------------------------------------------------------------
    function wake() {
        if (!ui) return;
        clearTimeout(dimTimer);
        ui.stage.classList.remove('is-dim');
        if (S.dictation.getState().phase === 'idle') scheduleDim();
    }

    function scheduleDim() {
        clearTimeout(dimTimer);
        if (!ui || !S.dictation.getState().dim) return ui?.stage.classList.remove('is-dim');
        dimTimer = setTimeout(() => {
            if (ui && ui.menu.classList.contains('hidden') && S.dictation.getState().phase === 'idle') ui.stage.classList.add('is-dim');
        }, DIM_AFTER_MS);
    }

    // --- The menu: styles, or instructions when rewording -------------------------------------------------
    function openMenu() {
        if (!ui) return;
        const st = S.dictation.getState();
        if (st.phase !== 'idle') return;
        ui.stage.classList.remove('is-dim');
        const tasks = el('div', { class: 'segmented mini-tasks', role: 'radiogroup', 'aria-label': 'Aufgabe' },
            ...[['dictate', 'Diktieren'], ['reword', 'Umformulieren']].map(([id, text]) =>
                el('button', { type: 'button', role: 'radio', 'aria-checked': String(st.task === id), text, onclick: () => { S.dictation.setTask(id); openMenu(); } })));
        const items = st.task === 'reword'
            ? st.suggestions.map(text => el('button', { type: 'button', class: 'mini-item', role: 'menuitem', text, onclick: () => { closeMenu(); S.dictation.reword(text); } }))
            : st.styles.map(s => el('button', {
                type: 'button', class: 'mini-item', role: 'menuitem', 'aria-checked': String(s.id === st.style), onclick: () => { S.dictation.setStyle(s.id); closeMenu(); }
            }, s.id === st.style ? S.icon('check') : el('span', { class: 'mini-item-gap' }), s.name));
        ui.menu.replaceChildren(tasks, ...items);
        ui.menu.classList.remove('hidden');
        ui.menu.querySelector('.mini-item')?.focus();
    }

    function closeMenu() {
        if (!ui) return;
        ui.menu.classList.add('hidden');
        scheduleDim();
    }

    // --- Copy ---------------------------------------------------------------------------------------------
    async function copyResult() {
        const st = S.dictation.getState();
        if (!ui || !st.result?.text) return;
        const text = st.result.text;
        try {
            await pip.navigator.clipboard.writeText(text);
            showNote('In die Zwischenablage kopiert.', 'success');
        } catch (_) {
            const area = ui.doc.createElement('textarea');
            area.value = text;
            ui.doc.body.append(area);
            area.select();
            const ok = ui.doc.execCommand?.('copy');
            area.remove();
            showNote(ok ? 'In die Zwischenablage kopiert.' : 'Kopieren wurde vom Browser blockiert.', ok ? 'success' : 'error');
        }
    }

    // --- The page: the sphere as the button that opens the window ------------------------------------------
    function renderPreview() {
        const host = $('dict-mini-preview');
        const st = S.dictation.getState();
        preview?.destroy();
        preview = S.orbs.create(st.skin, window, { size: 76, palette: st.palette, ink: getComputedStyle(document.body).color });
        host.replaceChildren(preview.el);
    }

    function init() {
        const button = $('dict-mini-open');
        if (supported()) {
            button.classList.remove('hidden');
            button.addEventListener('click', open);
            label();
            const host = $('dict-mini-preview');
            host.classList.remove('hidden');
            host.setAttribute('role', 'button');
            host.setAttribute('tabindex', '0');
            host.setAttribute('aria-label', 'Schwebendes Fenster öffnen');
            host.addEventListener('click', open);
            host.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
            renderPreview();
            S.dictation.on(type => { if (type === 'config') renderPreview(); });
        } else {
            $('dict-mini-note').textContent = 'Das schwebende Fenster gibt es in Chrome und Edge (ab Version 116). In diesem Browser bleibt das Diktat in diesem Tab.';
            $('dict-mini-note').classList.remove('hidden');
        }
    }

    S.dictationMini = { init, isOpen: () => !!pip, supported };
})(window.Unisono);

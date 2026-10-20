/*
 * Markers ("Merker"): points in time set while recording on site (recorder.js) or later at
 * the current position of the player. They appear
 *   - as a list in the transcript sidebar (rename, jump, remove),
 *   - as rows between the segments of the transcript,
 *   - as ticks on the timeline (player.js).
 * Interruptions of a recording are markers of kind 'gap'.
 */
window.Unisono = window.Unisono || {};

(function (S) {
    const $ = id => document.getElementById(id);
    let listEl, audio;
    let frame = null;

    function el(tag, className, props) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (props) Object.assign(node, props);
        return node;
    }

    function jump(time) {
        const seg = S.state.get().segments.find(s => s.end > time);
        if (seg) S.editor.reveal(seg.id, { flash: false });
        if (audio.currentSrc && !audio.error) audio.currentTime = time;
    }

    function renderList() {
        const { markers, segments } = S.state.get();
        $('marker-card').classList.toggle('hidden', !segments.length || !markers.length);
        const own = markers.filter(m => m.kind === 'mark').length;
        const gaps = markers.length - own;
        $('marker-count').textContent = [own && `${own} Merker`, gaps && `${gaps} Unterbrechung${gaps === 1 ? '' : 'en'}`].filter(Boolean).join(' · ');
        $('marker-list').replaceChildren(...markers.map(m => {
            const item = el('li', 'marker-item' + (m.kind === 'gap' ? ' is-gap' : ''));
            item.dataset.marker = m.id;
            const time = el('button', 'marker-time', { type: 'button', textContent: S.format.clock(m.time), title: 'Zu dieser Stelle springen' });
            time.addEventListener('click', () => jump(m.time));
            const label = el('input', 'marker-label', { value: m.label, spellcheck: true });
            label.setAttribute('aria-label', `Bezeichnung des Merkers bei ${S.format.clock(m.time)}`);
            label.addEventListener('input', () => S.state.renameMarker(m.id, label.value));
            const remove = el('button', 'icon-btn', { type: 'button', title: 'Merker entfernen' });
            remove.setAttribute('aria-label', `Merker „${m.label}“ entfernen`);
            remove.append(S.icon('trash'));
            remove.addEventListener('click', () => S.state.removeMarker(m.id));
            item.append(S.icon('flag'), time, label, remove);
            return item;
        }));
    }

    // One row per marker, before the segment in which (or after which) it was set.
    function renderRows() {
        listEl.querySelectorAll('.marker-row').forEach(row => row.remove());
        const { markers, segments } = S.state.get();
        if (!segments.length) return;
        for (const m of markers) {
            const seg = segments.find(s => s.end > m.time);
            const row = el('button', 'marker-row' + (m.kind === 'gap' ? ' is-gap' : ''), { type: 'button', title: 'Zu dieser Stelle springen' });
            row.dataset.marker = m.id;
            row.append(S.icon('flag'), el('span', 't-mono', { textContent: S.format.clock(m.time) }), el('span', 'marker-row-label', { textContent: m.label }));
            row.addEventListener('click', () => jump(m.time));
            const before = seg && listEl.querySelector(`.segment[data-id="${CSS.escape(seg.id)}"]`);
            if (before) listEl.insertBefore(row, before);
            else listEl.append(row);
        }
    }

    function renderAll() {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            renderList();
            renderRows();
            S.player.redraw();
        });
    }

    function onStateChange(type, id) {
        if (['text', 'speaker-renamed', 'tasks', 'project'].includes(type)) return;
        if (type === 'markers' && id) {
            // Only a label changed: update the row text, keep the focus in the list.
            const m = S.state.get().markers.find(x => x.id === id);
            const label = listEl.querySelector(`.marker-row[data-marker="${CSS.escape(id)}"] .marker-row-label`);
            if (m && label) label.textContent = m.label;
            S.player.redraw();
            return;
        }
        renderAll();
    }

    function updateAddButton() {
        const ready = !!audio.currentSrc && !audio.error;
        $('marker-add').disabled = !ready;
    }

    function init() {
        listEl = $('segment-list');
        audio = $('audio-player');
        $('marker-add').addEventListener('click', () => {
            if (!audio.currentSrc) return;
            const id = S.state.addMarker(audio.currentTime);
            requestAnimationFrame(() => $('marker-list').querySelector(`[data-marker="${CSS.escape(id)}"] .marker-label`)?.select());
        });
        ['loadedmetadata', 'emptied', 'error'].forEach(type => audio.addEventListener(type, updateAddButton));
        S.state.subscribe(onStateChange);
        updateAddButton();
        renderAll();
    }

    S.markers = { init, jump };
})(window.Unisono);

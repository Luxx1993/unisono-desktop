/*
 * Search & replace in the transcript.
 *
 * Hits are painted in a layer behind each (transparent) textarea: .seg-marks mirrors the text
 * with <mark> elements, so the text stays editable while the hits are visible. Enter / Shift+Enter
 * step through the hits, "nur Treffer" hides all other segments, and replace works on the
 * current hit or on all of them. Ctrl/Cmd+F opens the search while the transcript is shown.
 */
window.Unisono = window.Unisono || {};

(function (S) {
    const $ = id => document.getElementById(id);

    let listEl;
    let query = '';
    let matches = [];          // [{ id, start, end }] in reading order
    let current = -1;
    const marked = new Set();  // segment ids whose mark layer is filled

    function pattern() {
        if (!query) return null;
        return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    }

    function findAll() {
        const re = pattern();
        matches = [];
        if (!re) return;
        for (const seg of S.state.get().segments) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(seg.text))) {
                matches.push({ id: seg.id, start: m.index, end: m.index + m[0].length });
                if (m[0].length === 0) re.lastIndex++;
            }
        }
    }

    function rowOf(id) {
        return listEl.querySelector(`.segment[data-id="${CSS.escape(id)}"]`);
    }

    // Fills the mark layer of one segment with its text and <mark> elements for the hits.
    function paintRow(id) {
        const row = rowOf(id);
        if (!row) return;
        const layer = row.querySelector('.seg-marks');
        const hits = matches.filter(m => m.id === id);
        row.classList.toggle('has-match', hits.length > 0);
        row.classList.toggle('has-current', current >= 0 && matches[current].id === id);
        if (!hits.length) {
            layer.replaceChildren();
            marked.delete(id);
            return;
        }
        const text = row.querySelector('.seg-text').value;
        const parts = [];
        let at = 0;
        for (const hit of hits) {
            parts.push(document.createTextNode(text.slice(at, hit.start)));
            const mark = document.createElement('mark');
            mark.textContent = text.slice(hit.start, hit.end);
            if (matches[current] === hit) mark.className = 'is-current';
            parts.push(mark);
            at = hit.end;
        }
        // A trailing newline needs a character after it, or the layer would be one line short.
        parts.push(document.createTextNode(text.slice(at) + '​'));
        layer.replaceChildren(...parts);
        marked.add(id);
    }

    function paintAll() {
        const ids = new Set(matches.map(m => m.id));
        for (const id of [...marked]) if (!ids.has(id)) paintRow(id);
        for (const id of ids) paintRow(id);
        listEl.classList.toggle('search-only', $('search-only').getAttribute('aria-pressed') === 'true' && !!query);
        updateCount();
    }

    function updateCount() {
        const count = $('search-count');
        if (!query) count.textContent = '';
        else if (!matches.length) count.textContent = 'Keine Treffer';
        else count.textContent = `${current + 1} / ${matches.length}`;
        count.classList.toggle('is-empty', !!query && !matches.length);
        ['search-prev', 'search-next', 'replace-one', 'replace-all'].forEach(id => { $(id).disabled = !matches.length; });
    }

    function showCurrent() {
        if (current < 0) return;
        const hit = matches[current];
        const mark = rowOf(hit.id)?.querySelector('mark.is-current');
        (mark || rowOf(hit.id))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function run({ keepPosition = false } = {}) {
        const before = matches[current];
        findAll();
        if (!matches.length) current = -1;
        else if (keepPosition && before) {
            // Stay at (or right after) the hit we were on.
            const i = matches.findIndex(m => m.id === before.id && m.start >= before.start);
            const nextSeg = matches.findIndex(m => S.state.get().segments.findIndex(s => s.id === m.id) > S.state.get().segments.findIndex(s => s.id === before.id));
            current = i >= 0 ? i : nextSeg >= 0 ? nextSeg : 0;
        } else current = 0;
        paintAll();
    }

    function step(delta) {
        if (!matches.length) return;
        const previous = matches[current]?.id;
        current = (current + delta + matches.length) % matches.length;
        if (previous && previous !== matches[current].id) paintRow(previous);
        paintRow(matches[current].id);
        updateCount();
        showCurrent();
    }

    function replaceText(text, from, to, value) {
        return text.slice(0, from) + value + text.slice(to);
    }

    function replaceOne() {
        const hit = matches[current];
        if (!hit) return;
        const seg = S.state.get().segments.find(s => s.id === hit.id);
        S.editor.setText(hit.id, replaceText(seg.text, hit.start, hit.end, $('replace-input').value));
        run({ keepPosition: true });
        showCurrent();
    }

    function replaceAll() {
        if (!matches.length) return;
        const count = matches.length;
        const value = $('replace-input').value;
        if (count > 1 && !confirm(`${count} Treffer von „${query}“ durch „${value}“ ersetzen?`)) return;
        const re = pattern();
        for (const id of new Set(matches.map(m => m.id))) {
            const seg = S.state.get().segments.find(s => s.id === id);
            S.editor.setText(id, seg.text.replace(re, () => value));
        }
        run();
        S.ui.setStatus(`${count} Ersetzung${count === 1 ? '' : 'en'} vorgenommen.`, 'success');
    }

    function setQuery(value) {
        query = value;
        run();
        showCurrent();
    }

    function onStateChange(type, id) {
        if (!query) return;
        if (type === 'text') {
            // Typing in a segment: recount, repaint that segment, don't jump around.
            run({ keepPosition: true });
            paintRow(id);
        } else if (type === 'reset' || type === 'segments') {
            marked.clear();
            run({ keepPosition: true });
        }
    }

    function toggleReplace(open) {
        const show = open ?? $('replace-row').classList.contains('hidden');
        $('replace-row').classList.toggle('hidden', !show);
        $('search-replace-toggle').setAttribute('aria-expanded', String(show));
        if (show) $('replace-input').focus();
    }

    function init() {
        listEl = $('segment-list');
        const input = $('search-input');
        let debounce = null;
        input.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => setQuery(input.value), 120);
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (input.value !== query) setQuery(input.value);
                else step(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape' && input.value) {
                e.preventDefault();
                input.value = '';
                setQuery('');
            }
        });
        $('search-next').addEventListener('click', () => step(1));
        $('search-prev').addEventListener('click', () => step(-1));
        $('search-only').addEventListener('click', () => {
            const on = $('search-only').getAttribute('aria-pressed') !== 'true';
            $('search-only').setAttribute('aria-pressed', String(on));
            paintAll();
        });
        $('search-replace-toggle').addEventListener('click', () => toggleReplace());
        $('replace-one').addEventListener('click', replaceOne);
        $('replace-all').addEventListener('click', replaceAll);
        $('replace-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
        });

        document.addEventListener('keydown', e => {
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f' || e.altKey) return;
            if ($('view-transcript').classList.contains('hidden') || !S.state.get().segments.length) return;
            e.preventDefault();
            input.focus();
            input.select();
        });

        S.state.subscribe(onStateChange);
        updateCount();
    }

    S.search = { init };
})(window.Unisono);

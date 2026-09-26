/*
 * Segment editor: renders the transcript as editable segments, colors speakers,
 * renames speakers globally, and syncs with the audio player (click-to-jump,
 * highlight of the segment currently playing).
 *
 * All DOM is built with textContent/value – transcript text is never parsed as HTML.
 */
window.Scribe = window.Scribe || {};
(function (S) {
    const PALETTE_SIZE = 8;
    // Browsers with CSS field-sizing grow textareas with their content natively – no JS needed.
    const NATIVE_AUTOSIZE = !!window.CSS?.supports?.('field-sizing', 'content');
    const NEW_SPEAKER = '__new';

    let listEl, speakersEl, player, followEl;
    let activeId = null;

    function init({ list, speakers, audio, follow }) {
        listEl = list;
        speakersEl = speakers;
        player = audio;
        followEl = follow;

        S.state.subscribe(onStateChange);
        player.addEventListener('timeupdate', syncActive);
        player.addEventListener('seeked', syncActive);
        listEl.classList.toggle('native-autosize', NATIVE_AUTOSIZE);
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => fitAll(listEl.querySelectorAll('.seg-text')), 150);
        });
        render();
    }

    function onStateChange(type, detail) {
        if (type === 'segments' && detail) patchSegments(detail);
        else if (type === 'reset' || type === 'segments') render();
        else if (type === 'speakers') { renderSpeakers(); refreshSpeakerSelects(); }
        else if (type === 'speaker-renamed') refreshSpeakerLabels(detail);
    }

    function render() {
        renderSpeakers();
        renderSegments();
        activeId = null;
        syncActive();
    }

    function colorClass(speakerId) {
        const i = S.state.speakerIndex(speakerId);
        return i < 0 ? 'spk-none' : 'spk-' + (i % PALETTE_SIZE);
    }

    function el(tag, className, props) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (props) Object.assign(node, props);
        return node;
    }

    // --- Talk time ---
    // Seconds per speaker, and the pauses: the part of the recording nobody speaks in.
    function talkTime() {
        const { segments } = S.state.get();
        const perSpeaker = {};
        for (const seg of segments) {
            if (!(seg.end > seg.start)) continue;
            const key = seg.speaker || '';
            perSpeaker[key] = (perSpeaker[key] || 0) + (seg.end - seg.start);
        }
        // Union of all spoken intervals (overlapping speech counts once).
        const spans = segments.filter(s => s.end > s.start).map(s => [s.start, s.end]).sort((a, b) => a[0] - b[0]);
        let spoken = 0, curStart = null, curEnd = null;
        for (const [a, b] of spans) {
            if (curEnd == null || a > curEnd) {
                if (curEnd != null) spoken += curEnd - curStart;
                curStart = a;
                curEnd = b;
            } else curEnd = Math.max(curEnd, b);
        }
        if (curEnd != null) spoken += curEnd - curStart;
        const total = S.player?.duration() || (spans.length ? spans[spans.length - 1][1] : 0);
        return { perSpeaker, total, pauses: Math.max(0, total - spoken) };
    }

    function shareText(seconds, total) {
        const pct = total ? Math.round((seconds / total) * 100) : 0;
        return `${pct} % · ${S.format.clock(seconds).replace(/^00:/, '')}`;
    }

    // --- Speaker panel ---
    function renderSpeakers() {
        const { speakers, segments } = S.state.get();
        speakersEl.replaceChildren();
        speakersEl.classList.toggle('hidden', !segments.length);
        if (!segments.length) return;
        const withTimes = S.state.hasTimes();
        const time = withTimes ? talkTime() : null;

        for (const spk of speakers) {
            const count = segments.filter(s => s.speaker === spk.id).length;
            const seconds = time?.perSpeaker[spk.id] || 0;
            const chip = el('label', 'speaker-chip ' + colorClass(spk.id), { title: `${count} Abschnitt${count === 1 ? '' : 'e'} – Name ändern gilt für alle Abschnitte dieses Sprechers` });
            if (time?.total) chip.style.setProperty('--share', (seconds / time.total * 100).toFixed(1) + '%');
            chip.append(el('span', 'speaker-dot'));
            const input = el('input', 'speaker-name', { value: spk.name, spellcheck: false });
            input.setAttribute('aria-label', `Name für Sprecher ${spk.id}`);
            input.dataset.speaker = spk.id;
            input.addEventListener('input', () => S.state.renameSpeaker(spk.id, input.value));
            input.addEventListener('blur', () => {
                if (!input.value.trim()) {
                    input.value = 'Sprecher ' + spk.id;
                    S.state.renameSpeaker(spk.id, input.value);
                }
            });
            chip.append(input, el('span', 'speaker-count', { textContent: time ? shareText(seconds, time.total) : String(count) }));
            speakersEl.append(chip);
        }

        if (time?.total) {
            const pause = el('div', 'speaker-chip speaker-pause', { title: 'Zeit, in der niemand spricht' });
            pause.style.setProperty('--share', (time.pauses / time.total * 100).toFixed(1) + '%');
            pause.append(el('span', 'speaker-dot'), el('span', 'speaker-name', { textContent: 'Pausen' }),
                el('span', 'speaker-count', { textContent: shareText(time.pauses, time.total) }));
            speakersEl.append(pause);
        }

        const add = el('button', 'speaker-add', { type: 'button', textContent: '+ Sprecher' });
        add.addEventListener('click', () => S.state.addSpeaker());
        speakersEl.append(add);
    }

    function refreshSpeakerLabels(speakerId) {
        const name = S.state.speakerName(speakerId);
        listEl.querySelectorAll(`option[value="${CSS.escape(speakerId)}"]`).forEach(o => { o.textContent = name; });
        // Renamed elsewhere than in its own field (e.g. by a project file): update the panel too.
        const input = speakersEl.querySelector(`input[data-speaker="${CSS.escape(speakerId)}"]`);
        if (input && input !== document.activeElement && input.value !== name) input.value = name;
    }

    function refreshSpeakerSelects() {
        listEl.querySelectorAll('.segment').forEach(row => {
            const seg = S.state.get().segments.find(s => s.id === row.dataset.id);
            if (seg) fillSpeakerSelect(row.querySelector('.seg-speaker'), seg.speaker);
        });
    }

    function fillSpeakerSelect(select, current) {
        select.replaceChildren(el('option', '', { value: '', textContent: '– ohne Sprecher –' }));
        for (const spk of S.state.get().speakers) {
            select.append(el('option', '', { value: spk.id, textContent: spk.name }));
        }
        select.append(el('option', '', { value: NEW_SPEAKER, textContent: '+ Neuer Sprecher …' }));
        select.value = current ?? '';
    }

    // --- Segment list ---
    function renderSegments() {
        const { segments } = S.state.get();
        listEl.replaceChildren();
        if (!segments.length) {
            listEl.append(el('p', 'segments-empty', { textContent: 'Das fertige Transkript erscheint hier. Jeder Abschnitt ist direkt bearbeitbar.' }));
            return;
        }
        const withTimes = S.state.hasTimes();
        segments.forEach((seg, i) => listEl.append(renderSegment(seg, withTimes, i === segments.length - 1)));
        requestAnimationFrame(() => fitAll(listEl.querySelectorAll('.seg-text')));
    }

    // Updates only the affected rows – re-rendering 1,000+ segments for a merge was slow.
    function patchSegments({ changed, removed }) {
        const { segments } = S.state.get();
        if (!segments.length) return render();
        const rowOf = id => listEl.querySelector(`.segment[data-id="${id}"]`);
        removed.forEach(id => rowOf(id)?.remove());
        const lastId = segments[segments.length - 1].id;
        // The last row has no merge button, so it must be redrawn if it changed position.
        const redraw = new Set([...changed, lastId]);
        const withTimes = S.state.hasTimes();
        const fresh = [];
        for (const id of redraw) {
            const seg = segments.find(s => s.id === id);
            const row = rowOf(id);
            if (!seg || !row) continue;
            const next = renderSegment(seg, withTimes, id === lastId);
            row.replaceWith(next);
            fresh.push(next.querySelector('.seg-text'));
        }
        requestAnimationFrame(() => fitAll(fresh));
        renderSpeakers();
        activeId = null;
        syncActive();
    }

    function renderSegment(seg, withTimes, isLast) {
        const row = el('div', 'segment ' + colorClass(seg.speaker));
        row.dataset.id = seg.id;

        const meta = el('div', 'seg-meta');

        const select = el('select', 'seg-speaker');
        select.setAttribute('aria-label', 'Sprecher dieses Abschnitts');
        fillSpeakerSelect(select, seg.speaker);
        select.addEventListener('change', () => {
            const value = select.value === NEW_SPEAKER ? S.state.addSpeaker() : select.value;
            S.state.setSegmentSpeaker(seg.id, value);
        });
        meta.append(select);

        if (withTimes) {
            const time = el('button', 'seg-time', {
                type: 'button',
                textContent: S.format.clock(seg.start),
                title: 'Audio ab hier abspielen'
            });
            time.addEventListener('click', () => jumpTo(seg.start));
            meta.append(time);
        }

        const actions = el('div', 'seg-actions');
        if (!isLast) {
            const merge = el('button', '', { type: 'button', title: 'Mit nächstem Abschnitt zusammenführen' });
            merge.append(el('span', 'material-symbols-outlined', { textContent: 'vertical_align_bottom' }));
            merge.addEventListener('click', () => S.state.mergeWithNext(seg.id));
            actions.append(merge);
        }
        const del = el('button', 'seg-delete', { type: 'button', title: 'Abschnitt löschen' });
        del.append(el('span', 'material-symbols-outlined', { textContent: 'delete' }));
        del.addEventListener('click', () => {
            if (confirm('Diesen Abschnitt löschen?')) S.state.deleteSegment(seg.id);
        });
        actions.append(del);
        meta.append(actions);

        const text = el('textarea', 'seg-text', { value: seg.text, rows: 1, spellcheck: true });
        text.setAttribute('aria-label', 'Text des Abschnitts');
        text.addEventListener('input', () => {
            fitHeight(text);
            S.state.updateText(seg.id, text.value);
        });

        // Search hits are drawn in a layer behind the (transparent) textarea, see search.js.
        const wrap = el('div', 'seg-text-wrap');
        wrap.append(el('div', 'seg-marks'), text);
        row.append(meta, wrap);
        return row;
    }

    // Sizing many textareas one by one (write height, read scrollHeight, repeat) forces a
    // full layout per textarea – with a 2-hour transcript that froze the page for seconds.
    // Batch it instead: all writes, then all reads, then all writes → three layouts in total.
    function fitAll(textareas) {
        if (NATIVE_AUTOSIZE) return;
        const list = [...textareas];
        list.forEach(t => { t.style.height = 'auto'; });
        // scrollHeight excludes the border; with box-sizing: border-box the height includes it.
        const heights = list.map(t => t.scrollHeight + t.offsetHeight - t.clientHeight);
        list.forEach((t, i) => { t.style.height = heights[i] + 'px'; });
    }

    function fitHeight(textarea) {
        fitAll([textarea]);
    }

    // --- Player sync ---
    function jumpTo(seconds) {
        if (!player.currentSrc) {
            S.ui.setStatus('Kein Audio geladen – Datei erneut auswählen, um im Audio zu springen.', 'error');
            return;
        }
        player.currentTime = seconds;
        player.play().catch(() => {});
    }

    function syncActive() {
        if (!player.currentSrc) return;
        const seg = S.state.segmentAt(player.currentTime);
        const id = seg?.id || null;
        if (id === activeId) return;
        listEl.querySelector('.segment.is-active')?.classList.remove('is-active');
        activeId = id;
        if (!id) return;
        const row = listEl.querySelector(`.segment[data-id="${id}"]`);
        if (!row) return;
        row.classList.add('is-active');
        const editing = listEl.contains(document.activeElement);
        if (followEl.checked && !player.paused && !editing) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // Scrolls a segment into view and flashes it (used by the timeline and the search).
    function reveal(id, { flash = true } = {}) {
        const row = listEl.querySelector(`.segment[data-id="${CSS.escape(id)}"]`);
        if (!row) return;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (!flash) return;
        row.classList.remove('is-flash');
        void row.offsetWidth;
        row.classList.add('is-flash');
    }

    // Replaces a segment's text from outside the textarea (search & replace).
    function setText(id, value) {
        const text = listEl.querySelector(`.segment[data-id="${CSS.escape(id)}"] .seg-text`);
        if (text) {
            text.value = value;
            fitHeight(text);
        }
        S.state.updateText(id, value);
    }

    S.editor = { init, reveal, setText, refreshSpeakers: () => renderSpeakers() };
})(window.Scribe);

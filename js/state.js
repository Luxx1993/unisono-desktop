/*
 * Central state: raw provider result, editable segments and speaker names.
 *
 * Segment:  { id: 'seg-1', speaker: 'A' | null, start: 12.4, end: 18.2, text: '…' }
 * Speaker:  { id: 'A', name: 'Sprecher A' }
 * Marker:   { id: 'mk-1', time: 723.5, label: 'Merker 1', kind: 'mark' | 'gap' }
 *           set while recording on site (or later in the player); 'gap' notes an interruption
 *
 * Segments reference speakers by id, so renaming a speaker updates every segment at once.
 * Exporters and the editor always read from here – manual edits flow into every output.
 *
 * Events passed to subscribers:
 *   'reset'            whole transcript replaced
 *   'segments'         segments added, removed, merged or reassigned
 *                      (detail: { changed: [ids], removed: [ids] } when only those rows changed)
 *   'speakers'         speaker added
 *   'speaker-renamed'  (detail: speaker id) name changed
 *   'text'             (detail: segment id) text of one segment changed
 *   'markers'          markers added, renamed or removed
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const STORAGE_KEY = 'unisono_session';
    const listeners = new Set();
    let seq = 0;
    let persistTimer = null;

    const state = {
        fileName: null,
        provider: null,
        createdAt: null,   // ISO date of the transcription
        raw: null,
        segments: [],
        speakers: [],
        markers: []
    };
    let markerSeq = 0;

    // Speaker index 0, 1, … → 'A', 'B', …, 'Z', 'AA', …
    function speakerLetter(index) {
        let s = '';
        let n = index + 1;
        while (n > 0) {
            s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    function subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function emit(type, detail) {
        schedulePersist();
        for (const fn of listeners) fn(type, detail);
    }

    // Providers (Gladia in particular) often split speech at every comma or short pause:
    // a 57-minute meeting came back as 1,366 fragments like "Ja," / "gut.". Consecutive
    // fragments of the same speaker are joined into readable paragraphs. Nothing is lost:
    // the text is concatenated and the time span covers both parts.
    const MERGE_MAX_GAP = 2;       // seconds of silence between fragments
    const MERGE_MAX_LENGTH = 60;   // seconds per resulting segment

    function consolidate(segments) {
        const out = [];
        for (const s of segments) {
            const prev = out[out.length - 1];
            const joinable = prev
                && prev.speaker === s.speaker
                && s.start - prev.end <= MERGE_MAX_GAP
                && s.end - prev.start <= MERGE_MAX_LENGTH;
            if (joinable) {
                prev.text = [prev.text, s.text].filter(Boolean).join(' ');
                prev.end = Math.max(prev.end, s.end);
            } else {
                out.push({ ...s });
            }
        }
        return out;
    }

    const roundMs = t => Math.round((Number.isFinite(t) ? t : 0) * 1000) / 1000;

    function newSegmentId() {
        return 'seg-' + (++seq);
    }

    function findSegmentIndex(id) {
        return state.segments.findIndex(s => s.id === id);
    }

    // --- Read access ---
    function get() {
        return state;
    }

    function getSpeaker(id) {
        return state.speakers.find(s => s.id === id) || null;
    }

    function speakerName(id) {
        return getSpeaker(id)?.name || '';
    }

    function speakerIndex(id) {
        return state.speakers.findIndex(s => s.id === id);
    }

    function hasTimes() {
        return state.segments.some(s => s.end > 0);
    }

    function hasSpeakers() {
        return state.segments.some(s => s.speaker != null);
    }

    function segmentAt(time) {
        return state.segments.find(s => time >= s.start && time < s.end) || null;
    }

    // --- Write access ---
    // segments: [{ speaker, start, end, text }] as returned by the provider modules.
    function normalizeMarkers(list) {
        return (Array.isArray(list) ? list : [])
            .filter(m => m && Number.isFinite(Number(m.time)))
            .map(m => ({ id: 'mk-' + (++markerSeq), time: roundMs(Number(m.time)), label: String(m.label ?? ''), kind: m.kind === 'gap' ? 'gap' : 'mark' }))
            .sort((a, b) => a.time - b.time);
    }

    function setTranscript({ raw, segments, provider, fileName, markers }) {
        const ids = [];
        for (const s of segments) {
            if (s.speaker != null && !ids.includes(s.speaker)) ids.push(s.speaker);
        }
        state.speakers = ids.map(id => ({ id, name: 'Sprecher ' + id }));
        const normalized = segments.map(s => ({
            speaker: s.speaker ?? null,
            start: roundMs(s.start),
            end: roundMs(s.end),
            text: (s.text || '').trim()
        }));
        state.segments = consolidate(normalized).map(s => ({ ...s, id: newSegmentId() }));
        state.raw = raw ?? null;
        state.provider = provider ?? null;
        state.fileName = fileName ?? null;
        state.createdAt = segments.length ? new Date().toISOString() : null;
        state.markers = segments.length ? normalizeMarkers(markers) : [];
        emit('reset');
    }

    // Opens a project file written by Unisono.export (format 'unisono', version 1).
    // Keeps the edited speaker names and segments exactly as saved.
    function loadProject(data) {
        if (data?.format !== 'unisono' || !Array.isArray(data.segments)) {
            throw new Error('Das ist keine Unisono-Projektdatei.');
        }
        state.speakers = (Array.isArray(data.speakers) ? data.speakers : [])
            .filter(s => s && typeof s.id === 'string')
            .map(s => ({ id: s.id, name: String(s.name ?? 'Sprecher ' + s.id) }));
        // Also joins fragments in projects saved before consolidation existed.
        state.segments = consolidate(data.segments.map(s => ({
            speaker: typeof s.speaker === 'string' ? s.speaker : null,
            start: roundMs(s.start),
            end: roundMs(s.end),
            text: String(s.text ?? '')
        }))).map(s => ({ ...s, id: newSegmentId() }));
        state.fileName = data.fileName || null;
        state.provider = data.provider || null;
        state.createdAt = data.createdAt || null;
        state.raw = data.raw ?? null;
        state.markers = normalizeMarkers(data.markers);
        emit('reset');
    }

    function clear() {
        setTranscript({ raw: null, segments: [], provider: null, fileName: null });
    }

    function updateText(segmentId, text) {
        const seg = state.segments[findSegmentIndex(segmentId)];
        if (!seg || seg.text === text) return;
        seg.text = text;
        emit('text', segmentId);
    }

    function renameSpeaker(speakerId, name) {
        const spk = getSpeaker(speakerId);
        if (!spk) return;
        spk.name = name;
        emit('speaker-renamed', speakerId);
    }

    function addSpeaker() {
        let i = 0;
        while (getSpeaker(speakerLetter(i))) i++;
        const id = speakerLetter(i);
        state.speakers.push({ id, name: 'Sprecher ' + id });
        emit('speakers');
        return id;
    }

    function setSegmentSpeaker(segmentId, speakerId) {
        const seg = state.segments[findSegmentIndex(segmentId)];
        if (!seg) return;
        seg.speaker = speakerId || null;
        emit('segments', { changed: [segmentId], removed: [] });
    }

    function mergeWithNext(segmentId) {
        const i = findSegmentIndex(segmentId);
        if (i < 0 || i >= state.segments.length - 1) return;
        const cur = state.segments[i];
        const next = state.segments[i + 1];
        cur.text = [cur.text.trim(), next.text.trim()].filter(Boolean).join(' ');
        cur.end = Math.max(cur.end, next.end);
        state.segments.splice(i + 1, 1);
        emit('segments', { changed: [cur.id], removed: [next.id] });
    }

    function deleteSegment(segmentId) {
        const i = findSegmentIndex(segmentId);
        if (i < 0) return;
        const [removed] = state.segments.splice(i, 1);
        emit('segments', { changed: [], removed: [removed.id] });
    }

    // --- Markers ---
    function addMarker(time, label) {
        const n = state.markers.filter(m => m.kind === 'mark').length + 1;
        const [marker] = normalizeMarkers([{ time, label: label || 'Merker ' + n, kind: 'mark' }]);
        state.markers.push(marker);
        state.markers.sort((a, b) => a.time - b.time);
        emit('markers');
        return marker.id;
    }

    function renameMarker(id, label) {
        const marker = state.markers.find(m => m.id === id);
        if (!marker || marker.label === label) return;
        marker.label = label;
        emit('markers', id);
    }

    function removeMarker(id) {
        const i = state.markers.findIndex(m => m.id === id);
        if (i < 0) return;
        state.markers.splice(i, 1);
        emit('markers');
    }

    // --- Persistence: edits survive a page reload (without the audio file itself) ---
    function schedulePersist() {
        clearTimeout(persistTimer);
        persistTimer = setTimeout(persist, 500);
    }

    function persist() {
        try {
            const { fileName, provider, createdAt, segments, speakers, markers } = state;
            if (!segments.length) localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, JSON.stringify({ fileName, provider, createdAt, segments, speakers, markers }));
        } catch (_) { /* storage unavailable or full – editing still works */ }
    }

    // Don't lose the last edit when the tab is closed or reloaded within the debounce window.
    window.addEventListener('pagehide', () => {
        if (persistTimer) {
            clearTimeout(persistTimer);
            persist();
        }
    });

    function restore() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) {}
        if (!saved || !Array.isArray(saved.segments) || !saved.segments.length) return false;
        state.fileName = saved.fileName || null;
        state.provider = saved.provider || null;
        state.createdAt = saved.createdAt || null;
        state.raw = null;
        state.speakers = Array.isArray(saved.speakers) ? saved.speakers : [];
        state.segments = saved.segments.map(s => ({ ...s, id: newSegmentId() }));
        state.markers = normalizeMarkers(saved.markers);
        for (const fn of listeners) fn('reset');
        return true;
    }

    S.speakerLetter = speakerLetter;
    S.state = {
        subscribe, get, getSpeaker, speakerName, speakerIndex, hasTimes, hasSpeakers, segmentAt,
        setTranscript, loadProject, clear, updateText, renameSpeaker, addSpeaker, setSegmentSpeaker,
        mergeWithNext, deleteSegment, restore, addMarker, renameMarker, removeMarker
    };
})(window.Unisono);

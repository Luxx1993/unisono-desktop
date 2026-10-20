/*
 * Archive logic without any DOM: what an archive entry stores, the key figures over all entries,
 * the search and the project data for a transcript that was made in the background.
 *
 * Kept free of the page so it can be tested with plain Node (tests/archive-core.test.js).
 * In the browser it is available as Unisono.archiveCore.
 */
(function (root) {
    const wordCount = text => (String(text || '').match(/\S+/g) || []).length;

    // An archive entry: the project data (same format as the project file) plus a few figures
    // for the list, so the list does not have to open every transcript.
    function entryFromProject(data, { id, savedAt = new Date().toISOString(), hasAudio = false } = {}) {
        const segments = Array.isArray(data?.segments) ? data.segments : [];
        const fileName = data?.fileName || null;
        return {
            id,
            title: titleOf(fileName),
            fileName,
            provider: data?.provider || null,
            project: data?.project?.name || null,
            openTasks: (Array.isArray(data?.tasks) ? data.tasks : []).filter(t => !t.done).length,
            createdAt: data?.createdAt || savedAt,
            updatedAt: savedAt,
            seconds: segments.reduce((max, s) => Math.max(max, Number(s.end) || 0), 0),
            words: segments.reduce((n, s) => n + wordCount(s.text), 0),
            speakers: new Set(segments.map(s => s.speaker).filter(Boolean)).size,
            preview: segments.map(s => s.text).join(' ').slice(0, 240),
            hasAudio,
            data
        };
    }

    function titleOf(fileName) {
        if (!fileName) return 'Transkript';
        return String(fileName).replace(/\.[a-z0-9]{2,5}$/i, '') || 'Transkript';
    }

    // Case-insensitive search in title, file name, provider and text; every word must match.
    function matches(entry, query) {
        const words = String(query || '').toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
        if (!words.length) return true;
        const text = [entry.title, entry.fileName, entry.provider, entry.project,
            ...(entry.data?.tasks || []).map(t => `${t.text} ${t.owner}`),
            ...(entry.data?.segments || []).map(s => s.text),
            ...(entry.data?.speakers || []).map(s => s.name)].join(' ').toLocaleLowerCase('de');
        return words.every(w => text.includes(w));
    }

    // Key figures over all entries. byProvider is sorted by audio time, largest first.
    function stats(entries, now = new Date()) {
        const month = now.getFullYear() * 12 + now.getMonth();
        const inMonth = e => { const d = new Date(e.createdAt); return d.getFullYear() * 12 + d.getMonth() === month; };
        const byProvider = new Map();
        for (const e of entries) {
            const key = e.provider || 'unbekannt';
            const p = byProvider.get(key) || { id: key, count: 0, seconds: 0 };
            p.count += 1;
            p.seconds += e.seconds || 0;
            byProvider.set(key, p);
        }
        const month_ = entries.filter(inMonth);
        return {
            count: entries.length,
            seconds: entries.reduce((n, e) => n + (e.seconds || 0), 0),
            words: entries.reduce((n, e) => n + (e.words || 0), 0),
            monthCount: month_.length,
            monthSeconds: month_.reduce((n, e) => n + (e.seconds || 0), 0),
            byProvider: [...byProvider.values()].sort((a, b) => b.seconds - a.seconds || b.count - a.count)
        };
    }

    // Project data for a transcript made in the background (offline queue), without touching the
    // open transcript. Opening it later goes through the normal project import.
    function projectFromResult({ raw = null, segments = [], provider = null, fileName = null, markers = [], createdAt = new Date().toISOString() }) {
        const ids = [];
        for (const s of segments) if (s.speaker != null && !ids.includes(s.speaker)) ids.push(s.speaker);
        return {
            format: 'unisono',
            version: 1,
            fileName, provider, createdAt,
            speakers: ids.map(id => ({ id, name: 'Sprecher ' + id })),
            segments: segments.map(s => ({ speaker: s.speaker ?? null, start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() })),
            markers: (markers || []).map(({ time, label, kind }) => ({ time, label, kind })),
            summary: '',
            raw
        };
    }

    // A failed upload that is worth trying again later: no connection, or the provider unreachable.
    function isNetworkError(err) {
        if (!err) return false;
        if (err.name === 'TypeError' && /fetch|network|load failed/i.test(err.message)) return true;
        return /Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED/i.test(String(err.message || ''));
    }

    const api = { entryFromProject, titleOf, matches, stats, projectFromResult, isNetworkError, wordCount };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) {
        root.Unisono = root.Unisono || {};
        root.Unisono.archiveCore = api;
    }
})(typeof window !== 'undefined' ? window : null);

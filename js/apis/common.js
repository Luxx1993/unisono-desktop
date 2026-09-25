/*
 * Shared helpers for the provider modules.
 *
 * Every provider registers itself in Scribe.apis[id] with:
 *   label, models: [{ id, name }], transcribe(file, options) → { raw, segments }
 * where segments are [{ speaker: 'A' | null, start, end, text }] with times in seconds.
 *
 * options: { key, model, language ('de' | … | 'auto'), diarize, speakers (number | null),
 *            proxy (Deepgram only), onStatus(text) }
 */
window.Scribe = window.Scribe || {};
(function (S) {
    const POLL_INTERVAL_MS = 3000;
    const POLL_TIMEOUT_MS = 60 * 60 * 1000;

    async function fetchJson(url, options, label) {
        const res = await fetch(url, options);
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) {}
        if (!res.ok) {
            const msg = data?.error?.message || data?.message || data?.err_msg
                || (typeof data?.error === 'string' ? data.error : null)
                || data?.detail?.message || (typeof data?.detail === 'string' ? data.detail : null)
                || text || res.statusText;
            throw new Error(`${label}: HTTP ${res.status} – ${msg}`);
        }
        return data;
    }

    // Calls check() every few seconds until it returns a truthy value (or throws).
    async function poll(label, onStatus, check) {
        const start = Date.now();
        while (Date.now() - start < POLL_TIMEOUT_MS) {
            onStatus(`${label} verarbeitet Audio … (${Math.round((Date.now() - start) / 1000)} s)`);
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            const done = await check();
            if (done) return done;
        }
        throw new Error(`${label}: Zeitüberschreitung beim Warten auf das Ergebnis.`);
    }

    function fallbackSegment(text) {
        return text ? [{ speaker: null, start: 0, end: 0, text }] : [];
    }

    S.apis = S.apis || {};
    S.http = { fetchJson, poll, fallbackSegment };
})(window.Scribe);

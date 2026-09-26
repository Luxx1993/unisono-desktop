/*
 * Shared helpers for the provider modules.
 *
 * Every provider registers itself in Scribe.apis[id] with:
 *   label, models: [{ id, name }], transcribe(file, options) → { raw, segments }
 * where segments are [{ speaker: 'A' | null, start, end, text }] with times in seconds.
 *
 * options: { key, model, language ('de' | … | 'auto'), diarize, speakers (number | null),
 *            vocabulary (string[] – already trimmed to the provider's limits),
 *            onStatus(text) }
 *
 * UI metadata: description, icon (Material Symbols name), keyUrl (where to create a key),
 * test(key) → { url, headers } for a cheap GET that proves the key works,
 * autoLanguageOnly (the provider ignores the language setting).
 *
 * Optional: vocabularySupport(model) → { maxTerms, maxChars, maxWords, note } or null,
 * describing whether and how the model accepts technical terms (see vocabulary.js).
 *
 * limits() → { maxBytes, maxSeconds } – checked before a file is sent
 * (see app.js), so a too-large or too-long file fails fast instead of after the upload.
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

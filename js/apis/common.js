/*
 * Shared helpers for the provider modules.
 *
 * Every provider registers itself in Unisono.apis[id] with:
 *   label, models: [{ id, name }], transcribe(file, options) → { raw, segments }
 * where segments are [{ speaker: 'A' | null, start, end, text }] with times in seconds.
 *
 * options: { key, model, language ('de' | … | 'auto'), diarize, speakers (number | null),
 *            vocabulary (string[] – already trimmed to the provider's limits),
 *            signal (AbortSignal – the user pressed "Abbrechen"),
 *            onStage(stage, text) with stage 'upload' | 'start' | 'process',
 *            onUpload(fraction 0…1) while the file is being sent }
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
 *
 * diarizes(model) → whether this model separates speakers (default: !noDiarization).
 * settings: [{ field, label, options?: [[value, text]], placeholder?, required?, note? }] – extra
 * fields in the provider's key row (region, server address); read with Unisono.providerSettings.get.
 * keyOptional: the provider works without a key (a server on the user's own machine).
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const POLL_INTERVAL_MS = 3000;
    const POLL_TIMEOUT_MS = 60 * 60 * 1000;

    function parseResponse(status, statusText, text, label) {
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (_) {}
        if (status < 200 || status >= 300) {
            const msg = data?.error?.message || data?.message || data?.err_msg
                || (typeof data?.error === 'string' ? data.error : null)
                || data?.detail?.message || (typeof data?.detail === 'string' ? data.detail : null)
                || text || statusText;
            throw new Error(`${label}: HTTP ${status} – ${msg}`);
        }
        return data;
    }

    function abortError() {
        return new DOMException('Abgebrochen', 'AbortError');
    }

    async function fetchJson(url, options, label) {
        const res = await fetch(url, options);
        return parseResponse(res.status, res.statusText, await res.text(), label);
    }

    // Like fetchJson, but for sending the audio file: fetch() can't report upload progress,
    // XMLHttpRequest can. onUpload(fraction) runs while sending, onUploaded() once the file
    // is completely sent (synchronous providers then start processing).
    function send(url, { method = 'POST', headers = {}, body, signal, onUpload, onUploaded }, label) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(abortError());
            const xhr = new XMLHttpRequest();
            xhr.open(method, url);
            for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
            xhr.upload.onprogress = e => { if (e.lengthComputable) onUpload?.(e.loaded / e.total); };
            xhr.upload.onload = () => { onUpload?.(1); onUploaded?.(); };
            xhr.onload = () => {
                try { resolve(parseResponse(xhr.status, xhr.statusText, xhr.responseText, label)); } catch (err) { reject(err); }
            };
            // Same message as a failed fetch() – app.js explains network/CORS problems from it.
            xhr.onerror = () => reject(new TypeError('Failed to fetch'));
            xhr.onabort = () => reject(abortError());
            signal?.addEventListener('abort', () => xhr.abort(), { once: true });
            xhr.send(body);
        });
    }

    function sleep(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(abortError());
            const timer = setTimeout(resolve, ms);
            signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
        });
    }

    // Calls check() every few seconds until it returns a truthy value (or throws).
    async function poll(label, onStage, check, signal) {
        const start = Date.now();
        while (Date.now() - start < POLL_TIMEOUT_MS) {
            onStage('process', `${label} verarbeitet das Audio …`);
            await sleep(POLL_INTERVAL_MS, signal);
            const done = await check();
            if (done) return done;
        }
        throw new Error(`${label}: Zeitüberschreitung beim Warten auf das Ergebnis.`);
    }

    function fallbackSegment(text) {
        return text ? [{ speaker: null, start: 0, end: 0, text }] : [];
    }

    // Per-provider settings from the key page (region, server address), stored per browser.
    const SETTINGS_KEY = 'unisono_provider_settings';
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (_) {}
    const providerSettings = {
        get: (id, field) => String(settings[id]?.[field] || '').trim(),
        set(id, field, value) {
            settings[id] = { ...settings[id], [field]: String(value || '').trim() };
            if (!settings[id][field]) delete settings[id][field];
            try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); return true; } catch (_) { return false; }
        },
        clear() {
            settings = {};
            try { localStorage.removeItem(SETTINGS_KEY); } catch (_) {}
        }
    };

    // A server address as typed: with a trailing slash, so paths can be appended.
    const withSlash = url => url ? url.replace(/\/*$/, '/') : '';

    // Whether the engine separates speakers with this model.
    const canDiarize = (id, model) => {
        const api = S.apis[id];
        if (!api) return false;
        return api.diarizes ? api.diarizes(model) : !api.noDiarization;
    };

    S.apis = S.apis || {};
    S.http = { fetchJson, send, poll, fallbackSegment, withSlash };
    S.providerSettings = providerSettings;
    S.canDiarize = canDiarize;
})(window.Unisono);

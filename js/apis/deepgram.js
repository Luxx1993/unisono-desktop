/*
 * Deepgram /v1/listen: one synchronous request.
 * Deepgram rejects browser requests (no CORS), so this goes through a proxy
 * such as deepgram-proxy/worker.js.
 */
window.Scribe = window.Scribe || {};
(function (S) {
    async function transcribe(file, { key, model, language, diarize, vocabulary, proxy, onStatus }) {
        const base = (proxy || 'https://api.deepgram.com').replace(/\/+$/, '');
        const params = new URLSearchParams({
            model, diarize: String(diarize), utterances: 'true', smart_format: 'true', punctuate: 'true'
        });
        if (language === 'auto') params.set('detect_language', 'true');
        else params.set('language', language);
        // Nova-3: keyterm prompting (repeat the parameter per term); older models: keywords.
        for (const term of vocabulary || []) params.append(model === 'nova-3' ? 'keyterm' : 'keywords', term);

        onStatus(`Sende Audio an Deepgram (${model}) …`);
        const raw = await S.http.fetchJson(`${base}/v1/listen?${params}`, {
            method: 'POST',
            headers: {
                'Authorization': 'Token ' + key,
                'Content-Type': file.type || 'application/octet-stream'
            },
            body: file
        }, 'Deepgram');

        let segments = (raw.results?.utterances || []).map(u => ({
            speaker: diarize && u.speaker != null ? S.speakerLetter(u.speaker) : null,
            start: u.start,
            end: u.end,
            text: u.transcript.trim()
        }));
        if (!segments.length) segments = S.http.fallbackSegment(raw.results?.channels?.[0]?.alternatives?.[0]?.transcript);
        return { raw, segments };
    }

    S.apis.deepgram = {
        label: 'Deepgram (Nova)',
        models: [
            { id: 'nova-3', name: 'Nova-3 (neuestes Modell)' },
            { id: 'nova-2', name: 'Nova-2' }
        ],
        needsProxy: true,
        // Deepgram itself takes 2 GB; a Cloudflare Worker (free/pro plan) accepts at most 100 MB per request.
        limits: ({ proxy }) => (proxy
            ? { maxBytes: 100 * 1024 * 1024, source: 'Proxy (Cloudflare Worker)' }
            : { maxBytes: 2 * 1024 * 1024 * 1024 }),
        // Terms travel in the URL, so keep the list moderate. Nova-2 keywords are single words.
        vocabularySupport: model => (model === 'nova-3' ? { maxTerms: 100 } : { maxTerms: 100, maxWords: 1 }),
        transcribe
    };
})(window.Scribe);

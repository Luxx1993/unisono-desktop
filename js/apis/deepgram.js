/*
 * Deepgram /v1/listen: one synchronous request.
 * Deepgram rejects browser requests (no CORS), so this goes through a proxy
 * such as deepgram-proxy/worker.js.
 */
window.Scribe = window.Scribe || {};
(function (S) {
    async function transcribe(file, { key, model, language, diarize, proxy, onStatus }) {
        const base = (proxy || 'https://api.deepgram.com').replace(/\/+$/, '');
        const params = new URLSearchParams({
            model, diarize: String(diarize), utterances: 'true', smart_format: 'true', punctuate: 'true'
        });
        if (language === 'auto') params.set('detect_language', 'true');
        else params.set('language', language);

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
        transcribe
    };
})(window.Scribe);

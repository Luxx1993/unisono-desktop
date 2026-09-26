/*
 * Mistral Voxtral: one synchronous multipart request to /v1/audio/transcriptions.
 *
 * Voxtral Mini Transcribe 2 returns speaker-labelled segments when asked for diarization
 * and segment timestamps. Mistral does not allow a fixed language together with
 * timestamps, so the language is detected automatically here.
 */
window.Scribe = window.Scribe || {};
(function (S) {
    async function transcribe(file, { key, model, diarize, vocabulary, onStatus }) {
        onStatus(`Sende Audio an Mistral Voxtral (${model}) … (kann bei langen Dateien dauern)`);
        const form = new FormData();
        form.append('model', model);
        form.append('file', file);
        form.append('timestamp_granularities', 'segment');
        if (diarize) form.append('diarize', 'true');
        for (const term of vocabulary || []) form.append('context_bias', term);

        const raw = await S.http.fetchJson('https://api.mistral.ai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key },
            body: form
        }, 'Mistral');

        let segments = (raw.segments || []).map(s => {
            const idx = diarize && s.speaker_id != null ? parseInt(String(s.speaker_id).replace(/\D/g, ''), 10) : NaN;
            return {
                speaker: Number.isNaN(idx) ? null : S.speakerLetter(idx),
                start: s.start,
                end: s.end,
                text: (s.text || '').trim()
            };
        });
        if (!segments.length) segments = S.http.fallbackSegment(raw.text);
        return { raw, segments };
    }

    S.apis.mistral = {
        label: 'Mistral (Voxtral)',
        description: 'Europäischer Anbieter, schnell und günstig. Sprache wird automatisch erkannt.',
        icon: 'graphic_eq',
        models: [
            { id: 'voxtral-mini-latest', name: 'Voxtral Mini Transcribe (aktuell)' }
        ],
        keyUrl: 'https://console.mistral.ai/api-keys',
        // Language can't be combined with timestamps on Mistral's side.
        autoLanguageOnly: true,
        vocabularySupport: () => ({ maxTerms: 100, note: 'Hinweis: Mistral optimiert Fachbegriffe vor allem für Englisch; für Deutsch ist das noch experimentell.' }),
        limits: () => ({}),
        test: key => ({ url: 'https://api.mistral.ai/v1/models', headers: { 'Authorization': 'Bearer ' + key } }),
        transcribe
    };
})(window.Scribe);

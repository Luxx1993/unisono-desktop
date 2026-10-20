/*
 * Mistral Voxtral: one synchronous multipart request to /v1/audio/transcriptions.
 *
 * Voxtral Mini Transcribe 2 and Voxtral 3 return speaker-labelled segments when asked for diarization
 * and segment timestamps. Mistral does not allow a fixed language together with
 * timestamps, so the language is detected automatically here.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    async function transcribe(file, { key, model, diarize, vocabulary, signal, onStage, onUpload }) {
        onStage('upload', `Sende Audio an Mistral Voxtral (${model}) …`);
        const form = new FormData();
        form.append('model', model);
        form.append('file', file);
        form.append('timestamp_granularities', 'segment');
        if (diarize) form.append('diarize', 'true');
        for (const term of vocabulary || []) form.append('context_bias', term);

        // Synchronous: the answer arrives once Mistral has processed the whole file.
        const raw = await S.http.send('https://api.mistral.ai/v1/audio/transcriptions', {
            headers: { 'Authorization': 'Bearer ' + key },
            body: form,
            signal,
            onUpload,
            onUploaded: () => onStage('process', 'Mistral verarbeitet das Audio …')
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
        description: 'Europäischer Anbieter, schnell und günstig. Sprache wird automatisch erkannt. Derselbe Key dient zum Aufräumen.',
        icon: 'graphic_eq',
        models: [
            { id: 'voxtral-mini-latest', name: 'Voxtral Mini Transcribe (aktuell)' },
            // Voxtral 3 (Oktober 2026): Small ist am genauesten, Mini günstiger. Die IDs stehen so auf den Modellseiten von Mistral.
            { id: 'voxtral-small-transcribe-3-0', name: 'Voxtral Small Transcribe 3 (genauestes Modell)' },
            { id: 'voxtral-mini-transcribe-3-0', name: 'Voxtral Mini Transcribe 3' }
        ],
        keyUrl: 'https://console.mistral.ai/api-keys',
        keyGuide: {
            steps: [
                'Auf console.mistral.ai ein Konto anlegen.',
                'Einen Plan wählen: „Experiment“ ist kostenlos (Telefonnummer wird bestätigt), „Scale“ wird nach Verbrauch abgerechnet.',
                '„API Keys“ öffnen, „Create new key“ wählen und den Key sofort kopieren.',
                'Hier einfügen. Ein neuer Key ist manchmal erst nach wenigen Minuten aktiv.'
            ],
            note: 'Mistral sitzt in Frankreich (EU).'
        },
        // Language can't be combined with timestamps on Mistral's side.
        autoLanguageOnly: true,
        vocabularySupport: () => ({ maxTerms: 100, note: 'Hinweis: Mistral optimiert Fachbegriffe vor allem für Englisch; für Deutsch ist das noch experimentell.' }),
        limits: () => ({}),
        test: key => ({ url: 'https://api.mistral.ai/v1/models', headers: { 'Authorization': 'Bearer ' + key } }),
        transcribe
    };
})(window.Unisono);

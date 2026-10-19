/* Gladia v2: upload → /v2/pre-recorded → poll result_url. */
window.Unisono = window.Unisono || {};
(function (S) {
    const BASE = 'https://api.gladia.io/v2';

    async function transcribe(file, { key, model, language, diarize, speakers, vocabulary, signal, onStage, onUpload }) {
        if (model === 'solaria-3' && language === 'auto') {
            throw new Error('Solaria 3 benötigt eine feste Sprache.');
        }

        onStage('upload', 'Lade Datei zu Gladia hoch …');
        const form = new FormData();
        form.append('audio', file);
        const upload = await S.http.send(`${BASE}/upload`, {
            headers: { 'x-gladia-key': key },
            body: form,
            signal,
            onUpload
        }, 'Gladia Upload');

        onStage('start', `Starte Gladia-Transkription (${model}) …`);
        const body = { audio_url: upload.audio_url, model, diarization: diarize };
        if (speakers) body.diarization_config = { number_of_speakers: speakers };
        if (language !== 'auto') body.language_config = { languages: [language], code_switching: false };
        if (vocabulary?.length) {
            body.custom_vocabulary = true;
            body.custom_vocabulary_config = { vocabulary, default_intensity: 0.5 };
        }
        const job = await S.http.fetchJson(`${BASE}/pre-recorded`, {
            method: 'POST',
            headers: { 'x-gladia-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal
        }, 'Gladia Start');

        const resultUrl = job.result_url || `${BASE}/pre-recorded/${job.id}`;
        const raw = await S.http.poll('Gladia', onStage, async () => {
            const d = await S.http.fetchJson(resultUrl, { headers: { 'x-gladia-key': key }, signal }, 'Gladia Status');
            if (d.status === 'error') throw new Error('Gladia: ' + (d.error_code || 'Verarbeitung fehlgeschlagen.'));
            return d.status === 'done' ? d : null;
        }, signal);

        const t = raw.result?.transcription || {};
        let segments = (t.utterances || []).map(u => ({
            speaker: diarize && u.speaker != null ? S.speakerLetter(u.speaker) : null,
            start: u.start,
            end: u.end,
            text: u.text.trim()
        }));
        if (!segments.length) segments = S.http.fallbackSegment(t.full_transcript);
        return { raw, segments };
    }

    S.apis.gladia = {
        label: 'Gladia',
        description: 'Hohe Präzision für europäische Sprachen, gute Sprechertrennung.',
        icon: 'record_voice_over',
        keyUrl: 'https://app.gladia.io/apikeys',
        keyGuide: {
            steps: [
                'Auf app.gladia.io ein Konto anlegen (E-Mail oder Google-Konto).',
                'Im Menü links „API Keys“ öffnen.',
                'Einen Key erzeugen und sofort kopieren.',
                'Hier einfügen und mit „Prüfen“ testen.'
            ],
            note: 'Gladia sitzt in Frankreich. Ob Dateien ausschließlich in der EU verarbeitet werden, nennt die Doku nicht (nur für Live gibt es die Region EU-West). Zum Ausprobieren gibt es ein kostenloses Kontingent, danach wird nach Audio-Stunden abgerechnet.'
        },
        test: key => ({ url: 'https://api.gladia.io/v2/pre-recorded?limit=1', headers: { 'x-gladia-key': key } }),
        models: [
            { id: 'solaria-3', name: 'Solaria 3 (höchste Präzision, DE/EN/FR/ES/IT)' },
            { id: 'solaria-1', name: 'Solaria 1 (100+ Sprachen)' }
        ],
        vocabularySupport: () => ({}),
        limits: () => ({ maxBytes: 1000 * 1024 * 1024, maxSeconds: 135 * 60 }),
        transcribe
    };
})(window.Unisono);

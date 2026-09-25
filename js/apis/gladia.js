/* Gladia v2: upload → /v2/pre-recorded → poll result_url. */
window.Scribe = window.Scribe || {};
(function (S) {
    const BASE = 'https://api.gladia.io/v2';

    async function transcribe(file, { key, model, language, diarize, speakers, vocabulary, onStatus }) {
        if (model === 'solaria-3' && language === 'auto') {
            throw new Error('Solaria 3 benötigt eine feste Sprache.');
        }

        onStatus('Lade Datei zu Gladia hoch …');
        const form = new FormData();
        form.append('audio', file);
        const upload = await S.http.fetchJson(`${BASE}/upload`, {
            method: 'POST',
            headers: { 'x-gladia-key': key },
            body: form
        }, 'Gladia Upload');

        onStatus(`Starte Gladia-Transkription (${model}) …`);
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
            body: JSON.stringify(body)
        }, 'Gladia Start');

        const resultUrl = job.result_url || `${BASE}/pre-recorded/${job.id}`;
        const raw = await S.http.poll('Gladia', onStatus, async () => {
            const d = await S.http.fetchJson(resultUrl, { headers: { 'x-gladia-key': key } }, 'Gladia Status');
            if (d.status === 'error') throw new Error('Gladia: ' + (d.error_code || 'Verarbeitung fehlgeschlagen.'));
            return d.status === 'done' ? d : null;
        });

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
        label: 'Gladia (v2)',
        models: [
            { id: 'solaria-3', name: 'Solaria 3 (höchste Präzision, DE/EN/FR/ES/IT)' },
            { id: 'solaria-1', name: 'Solaria 1 (100+ Sprachen)' }
        ],
        vocabularySupport: () => ({}),
        transcribe
    };
})(window.Scribe);

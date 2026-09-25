/* ElevenLabs Scribe: one synchronous multipart request. */
window.Scribe = window.Scribe || {};
(function (S) {
    async function transcribe(file, { key, model, language, diarize, speakers, onStatus }) {
        onStatus('Sende Audio an ElevenLabs Scribe … (kann bei langen Dateien dauern)');
        const form = new FormData();
        form.append('file', file);
        form.append('model_id', model);
        form.append('diarize', String(diarize));
        form.append('tag_audio_events', 'false');
        if (speakers) form.append('num_speakers', String(speakers));
        if (language !== 'auto') form.append('language_code', language);

        const raw = await S.http.fetchJson('https://api.elevenlabs.io/v1/speech-to-text', {
            method: 'POST',
            headers: { 'xi-api-key': key },
            body: form
        }, 'ElevenLabs');

        let segments = groupWords(raw.words || [], diarize);
        if (!segments.length) segments = S.http.fallbackSegment(raw.text);
        return { raw, segments };
    }

    // ElevenLabs returns single words; group consecutive words of the same speaker.
    // Without diarization, start a new segment after sentence-ending punctuation.
    function groupWords(words, diarize) {
        const out = [];
        let cur = null;
        for (const w of words) {
            if (w.type === 'audio_event') continue;
            const idx = diarize && w.speaker_id ? parseInt(w.speaker_id.replace(/\D/g, ''), 10) : NaN;
            const speaker = Number.isNaN(idx) ? null : S.speakerLetter(idx);
            const sentenceEnded = !diarize && cur && /[.!?]$/.test(cur.text.trim());
            if (w.type === 'word' && (!cur || cur.speaker !== speaker || sentenceEnded)) {
                if (cur) out.push(cur);
                cur = { speaker, start: w.start, end: w.end, text: '' };
            }
            if (!cur) continue;
            cur.text += w.text;
            if (w.type === 'word') cur.end = w.end;
        }
        if (cur) out.push(cur);
        return out.map(s => ({ ...s, text: s.text.trim() }));
    }

    S.apis.elevenlabs = {
        label: 'ElevenLabs (Scribe)',
        models: [
            { id: 'scribe_v2', name: 'Scribe v2 (neuestes Modell)' },
            { id: 'scribe_v1', name: 'Scribe v1' }
        ],
        transcribe
    };
})(window.Scribe);

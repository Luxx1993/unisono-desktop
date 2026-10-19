/* ElevenLabs Scribe: one synchronous multipart request. */
window.Unisono = window.Unisono || {};
(function (S) {
    async function transcribe(file, { key, model, language, diarize, speakers, vocabulary, signal, onStage, onUpload }) {
        onStage('upload', 'Sende Audio an ElevenLabs Scribe …');
        const form = new FormData();
        form.append('file', file);
        form.append('model_id', model);
        form.append('diarize', String(diarize));
        form.append('tag_audio_events', 'false');
        if (speakers) form.append('num_speakers', String(speakers));
        if (language !== 'auto') form.append('language_code', language);
        for (const term of vocabulary || []) form.append('keyterms', term);

        // Synchronous: the answer arrives once ElevenLabs has processed the whole file.
        const raw = await S.http.send('https://api.elevenlabs.io/v1/speech-to-text', {
            headers: { 'xi-api-key': key },
            body: form,
            signal,
            onUpload,
            onUploaded: () => onStage('process', 'ElevenLabs verarbeitet das Audio …')
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
        description: 'Sehr genaue Wortzeiten und bis zu 32 Sprecher. Ergebnis kommt in einem Schritt.',
        icon: 'waves',
        keyUrl: 'https://elevenlabs.io/app/developers/api-keys',
        keyGuide: {
            steps: [
                'Auf elevenlabs.io ein Konto anlegen.',
                'Über das Profil bzw. „Developers“ die Seite „API Keys“ öffnen.',
                '„Create API Key“ wählen und bei den Berechtigungen mindestens „Speech to Text“ erlauben.',
                'Den Key sofort kopieren – er wird nur einmal angezeigt – und hier einfügen.'
            ],
            note: 'Der kostenlose Plan enthält ein kleines monatliches Kontingent; Scribe v2 mit Fachbegriffen kostet etwas mehr.'
        },
        test: key => ({ url: 'https://api.elevenlabs.io/v1/models', headers: { 'xi-api-key': key } }),
        models: [
            { id: 'scribe_v2', name: 'Scribe v2 (neuestes Modell)' }
        ],
        limits: () => ({ maxBytes: 3 * 1024 * 1024 * 1024, maxSeconds: 10 * 3600 }),
        // Keyterms exist only on Scribe v2 and cost extra.
        vocabularySupport: model => model === 'scribe_v2'
            ? { maxTerms: 100, maxChars: 50, note: 'Hinweis: ElevenLabs berechnet mit Fachbegriffen ca. 30 % Aufpreis.' }
            : null,
        transcribe
    };
})(window.Unisono);

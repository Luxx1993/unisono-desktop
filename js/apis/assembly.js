/* AssemblyAI v2: upload → /v2/transcript → poll. */
window.Unisono = window.Unisono || {};
(function (S) {
    // The EU region (Dublin) keeps audio and transcript in the EU; it is chosen in the key row.
    const base = () => S.providerSettings.get('assembly', 'region') === 'eu'
        ? 'https://api.eu.assemblyai.com/v2' : 'https://api.assemblyai.com/v2';

    const SYNC_SUFFIX = '-sync';

    // The Sync API: one request, the answer is the transcript. Up to 256 MB / 20 minutes, no speaker labels.
    async function transcribeSync(file, { key, model, language, signal, onStage, onUpload }) {
        onStage('upload', 'Sende Audio an AssemblyAI …');
        const form = new FormData();
        form.append('audio', file);
        if (language && language !== 'auto') form.append('config', new Blob([JSON.stringify({ language_codes: [language.split('-')[0]] })], { type: 'application/json' }));
        const host = S.providerSettings.get('assembly', 'region') === 'eu' ? 'https://sync.eu.assemblyai.com' : 'https://sync.assemblyai.com';
        const raw = await S.http.send(host + '/v1/transcribe', {
            headers: { Authorization: key, 'X-AAI-Model': model.slice(0, -SYNC_SUFFIX.length) }, body: form, signal, onUpload,
            onUploaded: () => onStage('process', 'AssemblyAI verarbeitet das Audio …')
        }, 'AssemblyAI Sync');
        return { raw, segments: S.http.fallbackSegment((raw.text || '').trim()) };
    }

    async function transcribe(file, opts) {
        return opts.model.endsWith(SYNC_SUFFIX) ? transcribeSync(file, opts) : transcribeAsync(file, opts);
    }

    async function transcribeAsync(file, { key, model, language, diarize, speakers, vocabulary, signal, onStage, onUpload }) {
        const BASE = base();
        onStage('upload', 'Lade Datei zu AssemblyAI hoch …');
        const upload = await S.http.send(`${BASE}/upload`, {
            headers: { 'authorization': key, 'Content-Type': 'application/octet-stream' },
            body: file,
            signal,
            onUpload
        }, 'AssemblyAI Upload');

        onStage('start', `Starte AssemblyAI-Transkription (${model}) …`);
        const body = { audio_url: upload.upload_url, speech_models: [model], speaker_labels: diarize };
        if (speakers) body.speakers_expected = speakers;
        if (vocabulary?.length) {
            // Universal-3.5 Pro takes keyterm prompts; Universal-2 uses the older word boost.
            if (model === 'universal-2') Object.assign(body, { word_boost: vocabulary, boost_param: 'default' });
            else body.keyterms_prompt = vocabulary;
        }
        if (language === 'auto') body.language_detection = true;
        else body.language_code = language;
        const job = await S.http.fetchJson(`${BASE}/transcript`, {
            method: 'POST',
            headers: { 'authorization': key, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal
        }, 'AssemblyAI Start');

        const raw = await S.http.poll('AssemblyAI', onStage, async () => {
            const d = await S.http.fetchJson(`${BASE}/transcript/${job.id}`, { headers: { 'authorization': key }, signal }, 'AssemblyAI Status');
            if (d.status === 'error') throw new Error('AssemblyAI: ' + (d.error || 'Verarbeitung fehlgeschlagen.'));
            return d.status === 'completed' ? d : null;
        }, signal);

        // AssemblyAI already labels speakers 'A', 'B', … and reports milliseconds.
        let segments = (raw.utterances || []).map(u => ({
            speaker: diarize ? u.speaker : null,
            start: u.start / 1000,
            end: u.end / 1000,
            text: u.text
        }));
        if (!segments.length) segments = S.http.fallbackSegment(raw.text);
        return { raw, segments };
    }

    S.apis.assembly = {
        label: 'AssemblyAI',
        description: 'Bewährte Sprechertrennung für lange Meetings, bis 10 Stunden.',
        icon: 'groups',
        keyUrl: 'https://www.assemblyai.com/dashboard/api-keys',
        keyGuide: {
            steps: [
                'Auf assemblyai.com ein Konto anlegen.',
                'Im Dashboard „API Keys“ öffnen – ein Key ist meist schon angelegt.',
                'Den Key kopieren und hier einfügen.'
            ],
            note: 'Neue Konten bekommen ein Startguthaben zum Testen. Die EU-Region nutzt denselben Key.'
        },
        settings: [{
            field: 'region', label: 'Region', options: [['', 'Standard (USA)'], ['eu', 'EU (Dublin)']],
            note: 'Gilt auch für das Sync-Modell.'
        }],
        test: key => ({ url: base() + '/transcript?limit=1', headers: { 'authorization': key } }),
        models: [
            { id: 'universal-3-5-pro', name: 'Universal-3.5 Pro (höchste Genauigkeit)' },
            { id: 'universal-2', name: 'Universal-2 (99 Sprachen, günstiger)' },
            { id: 'universal-3-5-pro' + SYNC_SUFFIX, name: 'Universal-3.5 Pro Sync (eine Anfrage, bis 20 Min., ohne Sprecher)' }
        ],
        diarizes: model => !model.endsWith(SYNC_SUFFIX),
        vocabularySupport: () => ({ maxTerms: 1000, maxWords: 6 }),
        limits: model => model?.endsWith(SYNC_SUFFIX)
            ? { maxBytes: 256 * 1024 * 1024, maxSeconds: 20 * 60 }
            : { maxBytes: 2.2 * 1024 * 1024 * 1024, maxSeconds: 10 * 3600 },
        transcribe
    };
})(window.Unisono);

/*
 * More speech engines. They return plain text without speaker separation (noDiarization: true), so
 * the file page switches "Sprecher erkennen" off for them; they suit dictations best (quick: true).
 *
 * Endpoints, field names and model ids are the ones the Android app uses, which in turn come from
 * each provider's own documentation. quick: true marks engines that answer within a second or two.
 * keyId: the engine shares the key of another entry (AssemblyAI Sync uses the AssemblyAI key).
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const lang = language => (!language || language === 'auto') ? null : language;
    const plain = (text, raw) => ({ raw, segments: S.http.fallbackSegment((text || '').trim()) });

    function register(id, meta) {
        S.apis[id] = { noDiarization: true, quick: true, icon: 'graphic_eq', limits: () => ({}), ...meta };
    }

    function guide(host, keyPage, note) {
        return { steps: [`Auf ${host} ein Konto anlegen.`, keyPage, 'Einen neuen Key erzeugen und sofort kopieren.', 'Hier einfügen und mit „Prüfen“ testen.'], note };
    }

    const bearer = key => key ? { Authorization: 'Bearer ' + key } : {};
    const setting = (id, field) => S.providerSettings.get(id, field);
    const isEu = id => setting(id, 'region') === 'eu';
    const regionSetting = (eu, note) => ({ field: 'region', label: 'Region', options: [['', 'Standard'], ['eu', eu]], note });
    const termsAsPrompt = vocabulary => vocabulary?.length ? vocabulary.join(', ') : null;
    const promptSupport = () => ({ maxTerms: 50, maxChars: 40, note: 'Fachbegriffe gehen als Hinweis mit; der Anbieter wertet sie nur teilweise aus.' });

    // ---- OpenAI-style multipart upload to {base}audio/transcriptions --------------------------
    // OpenAI's diarizing model: answers with speaker turns, takes no prompt, and needs a chunking
    // strategy for audio over 30 seconds.
    const isDiarizeModel = model => /diarize/.test(model || '');

    function multipartEngine(id, { label, description, base, models, keyUrl, host, keyPage, note, headers = {}, modelsPath = 'models', ...extra }) {
        const baseUrl = typeof base === 'function' ? base : () => base;
        register(id, {
            label, description, keyUrl, keyGuide: guide(host, keyPage, note),
            models: models.map(m => ({ id: m, name: m })),
            test: key => ({ url: baseUrl() + modelsPath, headers: { ...bearer(key), ...headers } }),
            vocabularySupport: model => isDiarizeModel(model) ? null : promptSupport(),
            diarizes: isDiarizeModel,
            ...extra,
            async transcribe(file, { key, model, language, diarize, vocabulary, signal, onStage, onUpload }) {
                onStage('upload', `Sende Audio an ${label} …`);
                const speakers = isDiarizeModel(model);
                const form = new FormData();
                form.append('file', file);
                form.append('model', model);
                form.append('response_format', speakers && diarize ? 'diarized_json' : 'json');
                if (speakers) form.append('chunking_strategy', 'auto');
                if (lang(language)) form.append('language', language.split('-')[0]);
                const prompt = speakers ? null : termsAsPrompt(vocabulary);
                if (prompt) form.append('prompt', prompt);
                const raw = await S.http.send(baseUrl() + 'audio/transcriptions', {
                    headers: { ...bearer(key), ...headers }, body: form, signal, onUpload,
                    onUploaded: () => onStage('process', `${label} verarbeitet das Audio …`)
                }, label);
                if (speakers && diarize && Array.isArray(raw.segments)) return { raw, segments: speakerSegments(raw.segments) };
                return plain(raw.text, raw);
            }
        });
    }

    // Speaker labels as the provider names them ("A", "speaker_0", …) become A, B, … in order of appearance.
    function speakerSegments(list) {
        const letters = new Map();
        const letter = label => {
            if (label == null) return null;
            if (!letters.has(label)) letters.set(label, S.speakerLetter(letters.size));
            return letters.get(label);
        };
        return list.filter(seg => String(seg.text || '').trim()).map(seg => ({
            speaker: letter(seg.speaker), start: Number(seg.start) || 0, end: Number(seg.end) || 0, text: String(seg.text).trim()
        }));
    }

    multipartEngine('openai', {
        label: 'OpenAI', description: 'Spracherkennung von OpenAI; derselbe Key dient zum Aufräumen.',
        base: 'https://api.openai.com/v1/', models: ['gpt-transcribe', 'gpt-4o-transcribe-diarize'], keyUrl: 'https://platform.openai.com/api-keys',
        host: 'platform.openai.com', keyPage: 'Unter „Billing“ Guthaben aufladen – ein ChatGPT-Abo gilt für die API nicht – und „API keys“ öffnen.',
        note: 'Das Modell gpt-4o-transcribe-diarize trennt Sprecher; Fachbegriffe nimmt es nicht an.'
    });
    multipartEngine('groq', {
        label: 'Groq', description: 'Whisper in sehr hoher Geschwindigkeit; derselbe Key dient zum Aufräumen.',
        base: 'https://api.groq.com/openai/v1/', models: ['whisper-large-v3-turbo', 'whisper-large-v3'], keyUrl: 'https://console.groq.com/keys',
        host: 'console.groq.com', keyPage: 'Im Menü „API Keys“ öffnen.'
    });
    multipartEngine('scaleway', {
        label: 'Scaleway', description: 'Whisper bei einem europäischen Anbieter (Frankreich); derselbe Key dient zum Aufräumen.',
        base: 'https://api.scaleway.ai/v1/', models: ['whisper-large-v3'], keyUrl: 'https://console.scaleway.com/iam/api-keys',
        host: 'console.scaleway.com', keyPage: 'Unter „IAM → API keys“ einen Key anlegen.',
        note: 'Ob Scaleway Anfragen direkt aus dem Browser zulässt, ließ sich ohne Key nicht prüfen. „Prüfen“ zeigt es.'
    });
    multipartEngine('ovhcloud', {
        label: 'OVHcloud', description: 'Whisper bei einem europäischen Anbieter; derselbe Key dient zum Aufräumen.',
        base: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/', models: ['whisper-large-v3', 'whisper-large-v3-turbo'],
        keyUrl: 'https://manager.eu.ovhcloud.com/#/public-cloud/pci/projects', host: 'manager.eu.ovhcloud.com',
        keyPage: 'Im Public-Cloud-Projekt unter „AI Endpoints“ einen Key anlegen.'
    });
    multipartEngine('siliconflow', {
        label: 'SiliconFlow', description: 'Spracherkennung, in China erreichbar; derselbe Key dient zum Aufräumen.',
        base: 'https://api.siliconflow.cn/v1/', models: ['FunAudioLLM/SenseVoiceSmall', 'TeleAI/TeleSpeechASR'],
        keyUrl: 'https://cloud.siliconflow.cn/account/ak', host: 'cloud.siliconflow.cn', keyPage: 'Unter „API Keys“ einen Key anlegen.'
    });
    multipartEngine('together', {
        label: 'Together AI', description: 'Whisper und Parakeet als Dienst; derselbe Key dient zum Aufräumen.',
        base: 'https://api.together.xyz/v1/', models: ['openai/whisper-large-v3', 'nvidia/parakeet-tdt-0.6b-v3'], keyUrl: 'https://api.together.ai/settings/api-keys',
        host: 'together.ai', keyPage: 'Unter „Settings → API Keys“ einen Key anlegen.'
    });
    multipartEngine('openrouter', {
        label: 'OpenRouter', description: 'Mehrere Spracherkennungs-Modelle über einen Key; derselbe Key dient zum Aufräumen.',
        base: () => isEu('openrouter') ? 'https://eu.openrouter.ai/api/v1/' : 'https://openrouter.ai/api/v1/', headers: { 'X-Title': 'Unisono' },
        settings: [regionSetting('EU', 'Die EU-Adresse gibt es nur für Firmenkonten (Enterprise); sie gilt auch fürs Aufräumen.')],
        models: ['openai/gpt-transcribe', 'microsoft/mai-transcribe-2', 'google/gemini-3.5-transcribe', 'elevenlabs/scribe-v2', 'x-ai/grok-stt-1.0', 'assemblyai/universal-3-6-pro', 'mistralai/voxtral-mini-transcribe', 'deepgram/nova-3', 'nvidia/parakeet-tdt-0.6b-v3', 'openai/whisper-large-v3-turbo', 'openai/whisper-large-v3'],
        keyUrl: 'https://openrouter.ai/keys', host: 'openrouter.ai', keyPage: '„Keys“ öffnen.'
    });

    // ---- xAI: multipart to {base}stt ---------------------------------------------------------------
    const XAI_FORMAT_LANGUAGES = new Set(['ar', 'cs', 'da', 'nl', 'en', 'fil', 'fr', 'de', 'hi', 'id', 'it', 'ja', 'ko', 'mk', 'ms', 'fa', 'pl', 'pt', 'ro', 'ru', 'es', 'sv', 'th', 'tr', 'vi']);
    register('xai', {
        label: 'xAI (Grok)', description: 'Spracherkennung von xAI; derselbe Key dient zum Aufräumen.',
        keyUrl: 'https://console.x.ai/team/default/api-keys', keyGuide: guide('console.x.ai', 'Unter „API Keys“ einen Key anlegen.'),
        models: [{ id: 'grok-voice-transcribe-2.0', name: 'Grok Voice Transcribe 2.0' }],
        test: key => ({ url: 'https://api.x.ai/v1/models', headers: bearer(key) }),
        vocabularySupport: () => ({ maxTerms: 100, maxChars: 50 }),
        async transcribe(file, { key, model, language, vocabulary, signal, onStage, onUpload }) {
            onStage('upload', 'Sende Audio an xAI …');
            const form = new FormData();
            form.append('model', model);
            const base = lang(language)?.split('-')[0].toLowerCase();
            const code = base === 'tl' ? 'fil' : base;
            if (code && XAI_FORMAT_LANGUAGES.has(code)) { form.append('language', code); form.append('format', 'true'); }
            for (const term of vocabulary || []) form.append('keyterm', term);
            form.append('file', file);
            const raw = await S.http.send('https://api.x.ai/v1/stt', {
                headers: bearer(key), body: form, signal, onUpload,
                onUploaded: () => onStage('process', 'xAI verarbeitet das Audio …')
            }, 'xAI');
            return plain(raw.text, raw);
        }
    });

    // ---- Deepgram: raw audio bytes to {base}listen ---------------------------------------------------
    const deepgramBase = () => isEu('deepgram') ? 'https://api.eu.deepgram.com/v1/' : 'https://api.deepgram.com/v1/';
    register('deepgram', {
        label: 'Deepgram', description: 'Sehr schnelle Spracherkennung (Nova-3).',
        keyUrl: 'https://console.deepgram.com/signup?jump=keys', keyGuide: guide('console.deepgram.com', 'Im Dashboard „API Keys“ öffnen.', 'Neue Konten bekommen ein Startguthaben.'),
        models: [{ id: 'nova-3', name: 'Nova-3' }, { id: 'nova-2', name: 'Nova-2' }],
        settings: [regionSetting('EU', 'Die EU-Adresse nimmt denselben Key.')],
        test: key => ({ url: deepgramBase() + 'models', headers: { Authorization: 'Token ' + key } }),
        async transcribe(file, { key, model, language, signal, onStage, onUpload }) {
            onStage('upload', 'Sende Audio an Deepgram …');
            const params = new URLSearchParams({ model, smart_format: 'true' });
            if (lang(language)) params.set('language', language); else params.set('detect_language', 'true');
            const raw = await S.http.send(deepgramBase() + 'listen?' + params, {
                headers: { Authorization: 'Token ' + key, 'Content-Type': file.type || 'audio/webm' }, body: file, signal, onUpload,
                onUploaded: () => onStage('process', 'Deepgram verarbeitet das Audio …')
            }, 'Deepgram');
            return plain(raw.results?.channels?.[0]?.alternatives?.[0]?.transcript, raw);
        }
    });

    // ---- Soniox: upload → create → poll → fetch, then clean up -----------------------------------
    const sonioxBase = () => isEu('soniox') ? 'https://api.eu.soniox.com/v1/' : 'https://api.soniox.com/v1/';
    register('soniox', {
        label: 'Soniox', quick: false, description: 'Sehr genaue Spracherkennung; das Ergebnis kommt nach einigen Sekunden.',
        keyUrl: 'https://console.soniox.com/api-keys', keyGuide: guide('console.soniox.com', '„API Keys“ öffnen.'),
        models: [{ id: 'stt-async-v5', name: 'Soniox Async v5' }],
        settings: [regionSetting('EU', 'Für die EU-Region braucht es einen Key aus einem EU-Projekt der Soniox-Konsole.')],
        test: key => ({ url: sonioxBase() + 'models', headers: bearer(key) }),
        vocabularySupport: () => ({ maxTerms: 100, maxChars: 50 }),
        async transcribe(file, { key, model, language, vocabulary, signal, onStage, onUpload }) {
            const BASE = sonioxBase();
            onStage('upload', 'Lade Audio zu Soniox hoch …');
            const form = new FormData();
            form.append('file', file);
            const upload = await S.http.send(BASE + 'files', { headers: bearer(key), body: form, signal, onUpload }, 'Soniox Upload');
            let id = null;
            try {
                onStage('start', 'Starte Soniox …');
                const body = { model, file_id: upload.id };
                if (lang(language)) body.language_hints = [language];
                const context = termsAsPrompt(vocabulary);
                if (context) body.context = context;
                const job = await S.http.fetchJson(BASE + 'transcriptions', {
                    method: 'POST', headers: { ...bearer(key), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
                }, 'Soniox');
                id = job.id;
                await S.http.poll('Soniox', onStage, async () => {
                    const d = await S.http.fetchJson(BASE + 'transcriptions/' + id, { headers: bearer(key), signal }, 'Soniox Status');
                    if (d.status === 'error' || d.status === 'failed') throw new Error('Soniox: ' + (d.error_message || 'Verarbeitung fehlgeschlagen.'));
                    return d.status === 'completed' ? d : null;
                }, signal);
                const raw = await S.http.fetchJson(`${BASE}transcriptions/${id}/transcript`, { headers: bearer(key), signal }, 'Soniox Ergebnis');
                return plain(raw.text, raw);
            } finally {
                // Best effort: the audio should not stay on Soniox's servers.
                const del = url => fetch(url, { method: 'DELETE', headers: bearer(key) }).catch(() => {});
                if (id) del(BASE + 'transcriptions/' + id);
                del(BASE + 'files/' + upload.id);
            }
        }
    });

    // ---- Google Gemini: a multimodal model, audio inline as base64 -------------------------------------
    const toBase64 = blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('Die Aufnahme konnte nicht gelesen werden.'));
        reader.readAsDataURL(blob);
    });
    register('gemini', {
        label: 'Google Gemini', description: 'Gemini schreibt die Aufnahme mit; derselbe Key dient zum Aufräumen.',
        keyUrl: 'https://aistudio.google.com/app/apikey', keyGuide: guide('aistudio.google.com', '„Get API key“ öffnen.'),
        models: [{ id: 'gemini-3.5-transcribe', name: 'gemini-3.5-transcribe (Spracherkennung, „smart“)' },
            ...['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'].map(m => ({ id: m, name: m }))],
        test: key => ({ url: 'https://generativelanguage.googleapis.com/v1beta/models', headers: { 'x-goog-api-key': key } }),
        vocabularySupport: promptSupport,
        limits: () => ({ maxBytes: 15 * 1024 * 1024 }),
        async transcribe(file, opts) {
            if (opts.model === 'gemini-3.5-transcribe') return geminiTranscribe(file, opts);
            const { key, model, language, vocabulary, signal, onStage, onUpload } = opts;
            onStage('upload', 'Sende Audio an Gemini …');
            let instruction = 'Transcribe the speech in the audio exactly as spoken, with correct punctuation and capitalization. '
                + 'Output only the transcription text. Do not add any preamble, commentary, translation, quotation marks, or formatting. '
                + 'If there is no intelligible speech, output nothing at all.';
            if (lang(language)) instruction += ` The spoken language is '${language}'; transcribe in that language.`;
            if (vocabulary?.length) instruction += `\n\nStyle/context hint (use it to guide spelling and punctuation, but never transcribe the hint itself):\n${vocabulary.join(', ')}`;
            const body = {
                contents: [{ parts: [{ text: instruction }, { inline_data: { mime_type: file.type.split(';')[0] || 'audio/webm', data: await toBase64(file) } }] }],
                generationConfig: { temperature: 0 }
            };
            onUpload(1);
            onStage('process', 'Gemini verarbeitet das Audio …');
            const raw = await S.http.fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
            }, 'Gemini');
            return plain((raw.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''), raw);
        }
    });

    // Gemini's own speech model through the Interactions API: "smart" mode drops filler words and
    // false starts, the way a careful typist would.
    async function geminiTranscribe(file, { key, language, vocabulary, signal, onStage, onUpload }) {
        onStage('upload', 'Sende Audio an Gemini …');
        const transcription = { mode: { type: 'smart' } };
        if (lang(language)) transcription.language_codes = [language];
        if (vocabulary?.length) transcription.custom_vocabulary = vocabulary;
        const body = {
            model: 'gemini-3.5-transcribe',
            input: [{ type: 'audio', data: await toBase64(file), mime_type: file.type.split(';')[0] || 'audio/webm' }],
            generation_config: { transcription_config: transcription }
        };
        onUpload(1);
        onStage('process', 'Gemini verarbeitet das Audio …');
        const raw = await S.http.fetchJson('https://generativelanguage.googleapis.com/v1beta/interactions', {
            method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
        }, 'Gemini');
        const step = [...(raw.steps || raw.outputs || [])].reverse().find(s => s.type !== 'user_input');
        const text = (step?.content || []).map(c => c.text || '').join('') || raw.output_text || '';
        return plain(text, raw);
    }

    // ---- AssemblyAI Sync API: one request, the answer is the transcript --------------------------------
    register('assemblyai_sync', {
        label: 'AssemblyAI Sync', keyId: 'assembly',
        description: 'Die schnelle Anfrage-in-einem-Schritt-Variante von AssemblyAI (Key von AssemblyAI).',
        keyUrl: 'https://www.assemblyai.com/dashboard/api-keys',
        models: [{ id: 'universal-3-5-pro', name: 'Universal-3.5 Pro' }],
        async transcribe(file, { key, model, language, signal, onStage, onUpload }) {
            onStage('upload', 'Sende Audio an AssemblyAI …');
            const form = new FormData();
            form.append('audio', file);
            if (lang(language)) form.append('config', new Blob([JSON.stringify({ language_codes: [language.split('-')[0]] })], { type: 'application/json' }));
            const raw = await S.http.send((setting('assembly', 'region') === 'eu' ? 'https://sync.eu.assemblyai.com' : 'https://sync.assemblyai.com') + '/v1/transcribe', {
                headers: { Authorization: key, 'X-AAI-Model': model }, body: form, signal, onUpload,
                onUploaded: () => onStage('process', 'AssemblyAI verarbeitet das Audio …')
            }, 'AssemblyAI Sync');
            return plain(raw.text, raw);
        }
    });

    // ---- Microsoft Azure Speech: MAI-Transcribe through the fast transcription API --------------------
    // The address is the user's own Speech resource ("Keys and Endpoint" in the Azure portal).
    const AZURE_API = 'api-version=2025-10-15';
    const azureBase = () => S.http.withSlash(setting('azure', 'endpoint'));
    register('azure', {
        label: 'Microsoft Azure', quick: false, description: 'MAI-Transcribe über eine eigene Speech-Ressource, auch in Nordeuropa.',
        keyUrl: 'https://portal.azure.com/',
        keyGuide: {
            steps: ['Ein Azure-Konto anlegen (azure.microsoft.com/free).', 'Im Portal eine „Speech“-Ressource in einer Region mit MAI-Transcribe anlegen: East US, West US, West US 2, North Europe, Southeast Asia oder Central India.',
                'Unter „Keys and Endpoint“ den Key und den Endpunkt kopieren.', 'Beides hier einfügen und mit „Prüfen“ testen.'],
            note: 'North Europe (Irland) hält die Daten in der EU.'
        },
        settings: [{ field: 'endpoint', label: 'Endpunkt', placeholder: 'https://my-speech.cognitiveservices.azure.com/', required: true }],
        models: [{ id: 'MAI-Transcribe-2', name: 'MAI-Transcribe 2' }, { id: 'MAI-Transcribe-1.5', name: 'MAI-Transcribe 1.5' }],
        test: key => ({ url: `${azureBase()}speechtotext/models/base?${AZURE_API}`, headers: { 'Ocp-Apim-Subscription-Key': key } }),
        vocabularySupport: () => ({ maxTerms: 500, maxChars: 50 }),
        async transcribe(file, { key, model, language, vocabulary, signal, onStage, onUpload }) {
            onStage('upload', 'Sende Audio an Azure …');
            const definition = {};
            if (lang(language)) definition.locales = [language.split('-')[0]];
            // enhancedMode selects MAI at all; without it Azure quietly uses its ordinary model. "clean"
            // drops filler words (only MAI-Transcribe 2 has it).
            definition.enhancedMode = { enabled: true, model };
            if (!/-1(\.|$)/.test(model)) definition.enhancedMode.modelOptions = { transcribeStyle: 'clean' };
            if (vocabulary?.length) definition.phraseList = { phrases: vocabulary };
            const form = new FormData();
            form.append('audio', file);
            form.append('definition', JSON.stringify(definition));
            const raw = await S.http.send(`${azureBase()}speechtotext/transcriptions:transcribe?${AZURE_API}`, {
                headers: { 'Ocp-Apim-Subscription-Key': key }, body: form, signal, onUpload,
                onUploaded: () => onStage('process', 'Azure verarbeitet das Audio …')
            }, 'Azure');
            const parts = raw.combinedPhrases?.length ? raw.combinedPhrases : (raw.phrases || []);
            return plain(parts.map(p => p.text).join(' '), raw);
        }
    });

    // ---- Own server: anything that speaks the OpenAI API (faster-whisper-server, LocalAI, vLLM, …) ------
    multipartEngine('custom', {
        label: 'Eigener Server', description: 'Ein eigener Server mit OpenAI-kompatibler Schnittstelle; dient auch zum Aufräumen.',
        base: () => S.http.withSlash(setting('custom', 'baseUrl')), models: [],
        keyUrl: 'https://github.com/speaches-ai/speaches', keyOptional: true, quick: true,
        keyGuide: {
            steps: ['Einen Server mit OpenAI-kompatibler Schnittstelle starten (z. B. Speaches für Whisper, Ollama oder LM Studio fürs Aufräumen).',
                'Die Adresse eintragen, die auf /v1/ endet, z. B. http://localhost:8000/v1/.', 'Einen Key nur eintragen, wenn der Server einen verlangt.', 'Mit „Prüfen“ testen.'],
            note: 'Der Server muss Anfragen von dieser Seite zulassen (CORS). Läuft er auf diesem Rechner, fragt Chrome beim ersten Zugriff, ob die Seite das lokale Netzwerk nutzen darf.'
        },
        settings: [
            { field: 'baseUrl', label: 'Adresse', placeholder: 'http://localhost:8000/v1/', required: true },
            { field: 'sttModel', label: 'Modell für die Spracherkennung', placeholder: 'Systran/faster-whisper-large-v3' }
        ]
    });
    Object.defineProperty(S.apis.custom, 'models', {
        get: () => [{ id: setting('custom', 'sttModel') || 'whisper-1', name: setting('custom', 'sttModel') || 'whisper-1' }]
    });

    // What each provider accepts per request (the Android app's figures, from the providers' documentation).
    const MB = 1024 * 1024;
    const LIMITS = {
        openai: { maxBytes: 25 * MB }, groq: { maxBytes: 25 * MB }, scaleway: { maxBytes: 25 * MB }, openrouter: { maxBytes: 25 * MB },
        siliconflow: { maxBytes: 50 * MB }, xai: { maxBytes: 500 * 1000 * 1000 }, deepgram: { maxBytes: 2048 * MB }, ovhcloud: { maxBytes: 2048 * MB },
        assemblyai_sync: { maxBytes: 256 * MB, maxSeconds: 20 * 60 }, soniox: { maxSeconds: 300 * 60 },
        azure: { maxBytes: 300 * MB, maxSeconds: 2 * 3600 }
    };
    for (const [id, limit] of Object.entries(LIMITS)) S.apis[id].limits = () => limit;

    // The older engines: mark the quick ones (the Diktat page names the slower ones).
    for (const id of ['elevenlabs', 'mistral']) if (S.apis[id]) S.apis[id].quick = true;
})(window.Unisono);

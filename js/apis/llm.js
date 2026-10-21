/*
 * AI providers for the text steps (cleaning up a dictation, rewording, summaries).
 *
 * Unisono.llms[id] = { label, description, keyUrl, keyGuide, test(key), models: [id], defaultModel,
 *                      live (true: the provider lists its own models, see loadModels), chat(opts) }
 * chat({ key, model, system, user }) → the text of the answer.
 *
 * Model ids and base URLs are the ones the Android app uses (read from the providers' own pages);
 * a provider without a curated list leaves defaultModel empty and offers its live catalog instead,
 * because a guessed model id fails at the first request.
 * The key is stored under the provider's id – the same key as its speech engine where it has one.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const llms = {};

    function guide(host, keyPage, extra) {
        return {
            steps: [
                `Auf ${host} ein Konto anlegen.`,
                keyPage,
                'Einen neuen Key erzeugen und sofort kopieren – er wird oft nur einmal angezeigt.',
                'Hier einfügen und mit „Prüfen“ testen.'
            ],
            note: extra
        };
    }

    // ---- Anthropic (own wire format) ------------------------------------------------------------
    async function anthropicChat({ key, model, system, user }) {
        const headers = {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'content-type': 'application/json'
        };
        const body = { model, max_tokens: 16000, system, messages: [{ role: 'user', content: user }] };
        // On a safety decline, let the API re-run the request on a fallback model instead of stopping.
        if (['claude-opus-5', 'claude-fable-5-1'].includes(model)) {
            headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
            body.fallbacks = 'default';
        }
        const data = await S.http.fetchJson('https://api.anthropic.com/v1/messages', {
            method: 'POST', headers, body: JSON.stringify(body)
        }, 'Anthropic');

        if (data.stop_reason === 'refusal') {
            throw new Error('Anfrage wurde vom Modell abgelehnt' + (data.stop_details?.explanation ? ': ' + data.stop_details.explanation : '.'));
        }
        const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
        return data.stop_reason === 'max_tokens' ? text + '\n\n[… Ausgabe wegen Längenlimit abgeschnitten]' : text;
    }

    llms.anthropic = {
        label: 'Anthropic (Claude)',
        description: 'Aufräumen, Umformulieren, Zusammenfassungen und Protokolle.',
        keyUrl: 'https://console.anthropic.com/settings/keys',
        keyGuide: {
            steps: [
                'In der Anthropic Console (console.anthropic.com) ein Konto anlegen.',
                'Unter „Billing“ Guthaben aufladen – die API wird vorab bezahlt, ein Claude-Abo gilt hier nicht.',
                'Unter „Settings → API Keys“ auf „Create Key“ klicken und den Key sofort kopieren.',
                'Hier einfügen und mit „Prüfen“ testen.'
            ],
            note: 'Unter „Limits“ lässt sich eine monatliche Obergrenze setzen.'
        },
        test: key => ({
            url: 'https://api.anthropic.com/v1/models',
            headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
        }),
        models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'],
        defaultModel: 'claude-haiku-5-5',
        chat: anthropicChat
    };

    // ---- OpenAI-compatible providers (chat/completions with a Bearer key) -------------------------
    // base: the address, or a function for one that depends on a setting (region, own server).
    const bearer = key => key ? { Authorization: 'Bearer ' + key } : {};
    function compat(id, { label, description, base, keyUrl, host, keyPage, note, models = [], defaultModel, extraBody, headers = {}, ...extra }) {
        const baseUrl = typeof base === 'function' ? base : () => base;
        llms[id] = {
            label, description, keyUrl,
            keyGuide: guide(host, keyPage, note),
            test: key => ({ url: baseUrl() + 'models', headers: { ...bearer(key), ...headers } }),
            models,
            defaultModel: defaultModel ?? models[0] ?? '',
            live: true,
            baseUrl,
            headers,
            ...extra,
            chat: async ({ key, model, system, user }) => {
                const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
                Object.assign(body, extraBody?.(model));
                const data = await S.http.fetchJson(baseUrl() + 'chat/completions', {
                    method: 'POST',
                    headers: { ...bearer(key), 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify(body)
                }, label);
                return data.choices?.[0]?.message?.content || '';
            }
        };
    }

    compat('openai', {
        label: 'OpenAI', description: 'Aufräumen, Umformulieren und Zusammenfassungen.',
        base: 'https://api.openai.com/v1/', keyUrl: 'https://platform.openai.com/api-keys', host: 'platform.openai.com',
        keyPage: 'Unter „Billing“ Guthaben aufladen – ein ChatGPT-Abo gilt für die API nicht – und „API keys“ öffnen.',
        note: 'Unter „Limits“ lässt sich eine monatliche Obergrenze setzen.',
        models: ['gpt-6-luna', 'gpt-6.1-sol'],
        // gpt-6-luna thinks at "medium" unless told otherwise, which makes a short cleanup slow.
        extraBody: model => model === 'gpt-6-luna' ? { reasoning_effort: 'none' } : null
    });
    compat('groq', {
        label: 'Groq', description: 'Sehr schnelle Antworten, auch kostenlos nutzbar.',
        base: 'https://api.groq.com/openai/v1/', keyUrl: 'https://console.groq.com/keys', host: 'console.groq.com',
        keyPage: 'Im Menü „API Keys“ öffnen.',
        models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']
    });
    compat('gemini', {
        label: 'Google Gemini', description: 'Aufräumen und Zusammenfassungen mit Gemini.',
        base: 'https://generativelanguage.googleapis.com/v1beta/openai/', keyUrl: 'https://aistudio.google.com/app/apikey', host: 'aistudio.google.com',
        keyPage: '„Get API key“ öffnen.',
        models: ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
    });
    compat('mistral', {
        label: 'Mistral AI', description: 'Europäischer Anbieter (Frankreich).',
        base: 'https://api.mistral.ai/v1/', keyUrl: 'https://console.mistral.ai/api-keys', host: 'console.mistral.ai',
        keyPage: '„API Keys“ öffnen.',
        // From Mistral's changelog (2026-10-19); the live list follows once a key is there.
        models: ['mistral-small-2603'], defaultModel: ''
    });
    compat('openrouter', {
        label: 'OpenRouter', description: 'Ein Key für sehr viele Modelle verschiedener Anbieter.',
        // The EU address is set in the key row (shared with OpenRouter's speech engine).
        base: () => S.providerSettings.get('openrouter', 'region') === 'eu' ? 'https://eu.openrouter.ai/api/v1/' : 'https://openrouter.ai/api/v1/',
        keyUrl: 'https://openrouter.ai/keys', host: 'openrouter.ai',
        keyPage: '„Keys“ öffnen.',
        models: ['openai/gpt-6-luna'],
        headers: { 'X-Title': 'Unisono' }
    });
    compat('together', {
        label: 'Together AI', description: 'Offene Modelle als Dienst.',
        base: 'https://api.together.xyz/v1/', keyUrl: 'https://api.together.ai/settings/api-keys', host: 'together.ai',
        keyPage: 'Unter „Settings → API Keys“ einen Key anlegen.'
    });
    compat('deepinfra', {
        label: 'DeepInfra', description: 'Offene Modelle als Dienst.',
        base: 'https://api.deepinfra.com/v1/openai/', keyUrl: 'https://deepinfra.com/dash/api_keys', host: 'deepinfra.com',
        keyPage: 'Unter „API Keys“ einen Key anlegen.'
    });
    compat('xai', {
        label: 'xAI (Grok)', description: 'Aufräumen und Zusammenfassungen mit Grok.',
        base: 'https://api.x.ai/v1/', keyUrl: 'https://console.x.ai/team/default/api-keys', host: 'console.x.ai',
        keyPage: 'Unter „API Keys“ einen Key anlegen.',
        // From xAI's model list (2026-10-19); no default, the live list decides.
        models: ['grok-4.7', 'grok-4.6'], defaultModel: ''
    });
    compat('deepseek', {
        label: 'DeepSeek', description: 'Günstige Modelle aus China.',
        base: 'https://api.deepseek.com/v1/', keyUrl: 'https://platform.deepseek.com/api_keys', host: 'platform.deepseek.com',
        keyPage: 'Unter „API keys“ einen Key anlegen.',
        note: 'Die Server stehen in China.',
        // From DeepSeek's pricing page (2026-10-19); no default, the live list decides.
        models: ['deepseek-flash', 'deepseek-v4-pro'], defaultModel: ''
    });
    compat('cerebras', {
        label: 'Cerebras', description: 'Extrem schnelle Antworten offener Modelle.',
        base: 'https://api.cerebras.ai/v1/', keyUrl: 'https://cloud.cerebras.ai', host: 'cloud.cerebras.ai',
        keyPage: 'Links „API Keys“ öffnen.',
        note: 'Ob Cerebras Anfragen direkt aus dem Browser zulässt, ließ sich ohne Key nicht prüfen. „Prüfen“ zeigt es.',
        models: ['gpt-oss-120b', 'qwen-3.8-27b']
    });
    compat('siliconflow', {
        label: 'SiliconFlow', description: 'Offene Modelle, in China erreichbar.',
        base: 'https://api.siliconflow.cn/v1/', keyUrl: 'https://cloud.siliconflow.cn/account/ak', host: 'cloud.siliconflow.cn',
        keyPage: 'Unter „API Keys“ einen Key anlegen.',
        models: ['deepseek-ai/DeepSeek-V3.2', 'deepseek-ai/DeepSeek-V3.1', 'deepseek-ai/DeepSeek-V3']
    });
    compat('scaleway', {
        label: 'Scaleway', description: 'Europäischer Anbieter (Frankreich), Daten bleiben in der EU.',
        base: 'https://api.scaleway.ai/v1/', keyUrl: 'https://console.scaleway.com/iam/api-keys', host: 'console.scaleway.com',
        keyPage: 'Unter „IAM → API keys“ einen Key anlegen.',
        note: 'Ob Scaleway Anfragen direkt aus dem Browser zulässt, ließ sich ohne Key nicht prüfen. „Prüfen“ zeigt es.',
        models: ['mistral-small-3.2-24b-instruct-2506', 'llama-3.3-70b-instruct', 'gpt-oss-120b']
    });
    compat('ovhcloud', {
        label: 'OVHcloud', description: 'Europäischer Anbieter, Daten bleiben in der EU.',
        base: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/', keyUrl: 'https://manager.eu.ovhcloud.com/#/public-cloud/pci/projects', host: 'manager.eu.ovhcloud.com',
        keyPage: 'Im Public-Cloud-Projekt unter „AI Endpoints“ einen Key anlegen.',
        models: ['Mistral-Small-3.2-24B-Instruct-2506', 'Meta-Llama-3_3-70B-Instruct', 'gpt-oss-120b', 'gpt-oss-20b', 'Qwen3.8-27B']
    });

    // Servers on the user's own machine or network: no key needed, the address is set in the key row.
    const ownServer = id => () => S.http.withSlash(S.providerSettings.get(id, 'baseUrl'));
    compat('ollama', {
        label: 'Ollama', description: 'Offene Modelle auf dem eigenen Rechner, ohne Key und ohne Cloud.',
        base: ownServer('ollama'), keyUrl: 'https://ollama.com/download', keyOptional: true,
        settings: [{ field: 'baseUrl', label: 'Adresse', placeholder: 'http://localhost:11434/v1/', required: true }]
    });
    llms.ollama.keyGuide = {
        steps: ['Ollama installieren (ollama.com) und ein Modell laden, z. B. „ollama pull gemma3“.',
            'Ollama Anfragen von dieser Seite erlauben: die Umgebungsvariable OLLAMA_ORIGINS auf die Adresse dieser Seite (oder *) setzen und Ollama neu starten.',
            'Hier die Adresse eintragen, meist http://localhost:11434/v1/.', 'Mit „Prüfen“ testen. Chrome fragt beim ersten Zugriff, ob die Seite das lokale Netzwerk nutzen darf.'],
        note: 'Die Texte verlassen den Rechner nicht.'
    };
    compat('custom', {
        label: 'Eigener Server', description: 'Ein eigener Server mit OpenAI-kompatibler Schnittstelle.',
        base: ownServer('custom'), keyUrl: 'https://github.com/speaches-ai/speaches', keyOptional: true
    });

    // The provider's own model list (OpenAI-style GET /models), merged with the curated ids, without the
    // models that obviously are no chat models. Debounced: while a key is typed, only the last one is
    // sent. Resolves to null when a newer call replaced this one, and to the curated ids when offline.
    const CUSTOM = '__custom';
    const catalogs = new Map();
    const latest = {};
    const NOT_CHAT = /embed|whisper|tts|transcribe|moderation|dall-e|image|audio|realtime|rerank|speech/i;
    async function loadModels(id, key) {
        const llm = llms[id];
        if (!llm) return [];
        if (!llm.live || !(key || llm.keyOptional)) return llm.models;
        const base = llm.baseUrl();
        if (!base) return llm.models;
        const cacheKey = id + '|' + base + '|' + key;
        const token = latest[id] = (latest[id] || 0) + 1;
        if (!catalogs.has(cacheKey)) {
            await new Promise(resolve => setTimeout(resolve, 600));
            if (token !== latest[id]) return null;
            if (!catalogs.has(cacheKey)) {
                catalogs.set(cacheKey, fetch(base + 'models', { headers: { ...bearer(key), ...llm.headers } })
                    .then(res => res.ok ? res.json() : null)
                    .then(data => (data?.data || []).map(m => String(m.id).replace(/^models\//, '')).filter(m => m && !NOT_CHAT.test(m)))
                    .catch(() => []));
            }
        }
        const live = await catalogs.get(cacheKey);
        if (token !== latest[id]) return null;
        const ids = [...new Set([...llm.models, ...live])];
        ids.fromCatalog = live.length > 0;   // false: the catalog was out of reach, so nothing is known beyond the curated ids
        return ids;
    }

    // Fills a model drop-down with the models of one provider: the curated ones at once, the provider's own
    // catalog once it has arrived. The current model stays selected if the provider has it; otherwise the
    // provider's default (or its first model) is picked and reported through onPick.
    function fillModelSelect(select, provider, key, current, onPick) {
        const llm = llms[provider];
        select.dataset.provider = provider;
        select.title = 'Preis: Eingabe / Ausgabe in € je 1 Mio. Token';
        const option = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text || value });
        const set = (ids, keepCurrent, loading) => {
            if (select.dataset.provider !== provider) return;
            const list = [...ids];
            // The current model stays while the catalog is loading or out of reach (a model typed in by hand survives that).
            if (keepCurrent && current && !list.includes(current)) list.unshift(current);
            const options = list.map(id => option(id, S.prices.chatLabel(provider, id)));
            if (!list.length) options.push(option('', loading ? 'Modelle werden geladen …' : 'Modelle nicht abrufbar'));
            options.push(option(CUSTOM, 'Anderes Modell eintragen …'));
            select.replaceChildren(...options);
            select.disabled = false;
            if (list.includes(current)) select.value = current;
            else if (list.length) {
                const pick = list.includes(llm.defaultModel) ? llm.defaultModel : list[0];
                select.value = pick;
                onPick?.(pick);
            } else select.value = '';
            select.dataset.last = select.value;
        };
        // A model the list does not show can still be typed in (a new model, or a catalog that is out of reach).
        if (!select.dataset.bound) {
            select.dataset.bound = '1';
            select.addEventListener('change', () => {
                if (select.value !== CUSTOM) { select.dataset.last = select.value; return; }
                const id = (window.prompt('Modell-ID des Anbieters:') || '').trim();
                if (!id) { select.value = select.dataset.last || ''; return; }
                if (![...select.options].some(o => o.value === id)) select.insertBefore(option(id), select.lastElementChild);
                select.value = id;
                select.dataset.last = id;
                select.dispatchEvent(new Event('change'));
            });
        }
        const live = llm.live && (!!key || !!llm.keyOptional);
        set(llm.models, true, live);
        if (live) loadModels(provider, key).then(ids => { if (ids) set(ids, !ids.fromCatalog, false); });
    }

    // One request to the chosen provider: the text of the answer.
    function chat(provider, opts) {
        const llm = llms[provider];
        if (!llm) throw new Error('Unbekannter KI-Anbieter.');
        if (!opts.model) throw new Error(`Bitte ein Modell für ${llm.label} angeben.`);
        return llm.chat(opts);
    }

    S.llms = llms;
    S.llmApi = { loadModels, fillModelSelect, chat };
})(window.Unisono);

/*
 * List prices for speech recognition in euros per hour of audio, shown next to each model.
 * Pay-as-you-go prices from each provider's own price page, read on 2026-10-21 and converted at
 * 1 EUR = 1.1215 USD (Gladia, Scaleway and OVHcloud list in euros). Speaker labels and custom vocabulary
 * add a surcharge at some providers and are not included. Same figures as the Android app.
 *
 * Only what was found is listed; a model without an entry shows no price. approx: calculated from token
 * prices or from third-party sources.
 *
 * Kept free of the page so it can be tested with plain Node (tests/prices.test.js).
 * In the browser it is available as Unisono.prices.
 */
(function (root) {
    const p = (eur, approx) => ({ eur, approx: !!approx });

    // File transcription, keyed "engine id|model id" (lower case). Engine ids are the app's own.
    const BATCH = {
        'openrouter|openai/whisper-large-v3-turbo': p(0.0096),
        'openrouter|openai/whisper-large-v3': p(0.0257),
        'openrouter|nvidia/parakeet-tdt-0.6b-v3': p(0.0802),
        'openrouter|microsoft/mai-transcribe-2': p(0.0892),
        'openrouter|openai/gpt-transcribe': p(0.2407),
        'openrouter|elevenlabs/scribe-v2': p(0.1958),
        'openrouter|x-ai/grok-stt-1.0': p(0.0899),
        'openrouter|mistralai/voxtral-mini-transcribe': p(0.1605),
        'openrouter|google/gemini-3.5-transcribe': p(0.2675, true),
        'openrouter|deepgram/nova-3': p(0.2311, true),
        'openrouter|assemblyai/universal-3-6-pro': p(0.2664, true),
        'groq|whisper-large-v3-turbo': p(0.0357),
        'groq|whisper-large-v3': p(0.099),
        'ovhcloud|whisper-large-v3-turbo': p(0.046),
        'ovhcloud|whisper-large-v3': p(0.147),
        'scaleway|whisper-large-v3': p(0.18),
        'together|openai/whisper-large-v3': p(0.0802),
        'together|nvidia/parakeet-tdt-0.6b-v3': p(0.0802),
        'xai|grok-voice-transcribe-2.0': p(0.0892, true),
        'soniox|stt-async-v5': p(0.087, true),
        'azure|mai-transcribe-2': p(0.0892),
        'azure|mai-transcribe-1.5': p(0.321),
        'assembly|universal-2': p(0.1337),
        'assembly|universal-3-5-pro': p(0.1872),
        'assembly|universal-3-5-pro-sync': p(0.4012, true),
        'gladia|solaria-3': p(0.16),
        'gladia|solaria-1': p(0.27),
        'openai|gpt-4o-mini-transcribe': p(0.1605),
        'openai|gpt-transcribe': p(0.2407, true),
        'openai|gpt-4o-transcribe': p(0.321),
        'openai|gpt-4o-transcribe-diarize': p(0.321),
        'mistral|voxtral-mini-latest': p(0.1872, true),
        'mistral|voxtral-mini-transcribe-3-0': p(0.1872),
        'mistral|voxtral-small-transcribe-3-0': p(0.214),
        'elevenlabs|scribe_v2': p(0.1962),
        'deepgram|nova-3': p(0.23),
        'gemini|gemini-3.5-transcribe': p(0.2675, true),
        'gemini|gemini-3.6-flash': p(0.2318, true),
        'gemini|gemini-3.8-flash': p(0.2318, true),
        'gemini|gemini-3.5-flash-lite': p(0.058, true)
    };

    // Live transcription, which providers usually bill higher than files.
    const REALTIME = {
        'soniox|stt-rt-v5': p(0.107),
        'assembly|universal-streaming-english': p(0.1337),
        'assembly|universal-streaming-multilingual': p(0.1337),
        'assembly|universal-3-6-pro': p(0.4012),
        'xai|grok-voice-transcribe-2.0': p(0.1783, true),
        'deepgram|nova-2': p(0.3121),
        'deepgram|nova-3': p(0.2568, true),
        'deepgram|flux-general-en': p(0.3477, true),
        'deepgram|flux-general-multi': p(0.4173),
        'elevenlabs|scribe_v2_realtime': p(0.3477),
        'mistral|voxtral-mini-transcribe-realtime-3-0': p(0.428),
        'mistral|voxtral-mini-transcribe-realtime-2602': p(0.321),
        'gladia|solaria-1': p(0.68)
    };

    const c = (eurIn, eurOut, approx) => ({ eurIn, eurOut, approx: !!approx });

    // Text models (cleanup, rewording, summaries) in euros per 1 million tokens, input and output, keyed
    // "provider id|model id" (lower case). Standard pay-as-you-go prices of 2026-10-21 for short prompts, no batch,
    // cache or priority tariffs; dollar prices at 1 EUR = 1.1215 USD, Scaleway and OVHcloud list in euros.
    // approx: unconfirmed model id or third-party figure. Same figures as the Android app.
    const CHAT = {
        'anthropic|claude-fable-5': c(8.9166, 44.5831, true),
        'anthropic|claude-fable-5-1': c(8.9166, 44.5831),
        'anthropic|claude-haiku-4-5': c(0.8917, 4.4583, true),
        'anthropic|claude-haiku-5-5': c(0.0892, 0.4458),
        'anthropic|claude-opus-4-5': c(4.4583, 22.2916, true),
        'anthropic|claude-opus-4-6': c(4.4583, 22.2916, true),
        'anthropic|claude-opus-4-7': c(4.4583, 22.2916, true),
        'anthropic|claude-opus-4-8': c(4.4583, 22.2916, true),
        'anthropic|claude-opus-5': c(4.4583, 22.2916, true),
        'anthropic|claude-opus-5-5': c(3.5667, 17.8333),
        'anthropic|claude-sonnet-4-5': c(2.675, 13.3749, true),
        'anthropic|claude-sonnet-4-6': c(2.675, 13.3749, true),
        'anthropic|claude-sonnet-5': c(1.7833, 8.9166, true),
        'anthropic|claude-sonnet-5-5': c(1.7833, 8.9166),
        'cerebras|gpt-oss-120b': c(0.3121, 0.6687, true),
        'deepinfra|anthropic/claude-haiku-4-5': c(0.8917, 4.4583),
        'deepinfra|anthropic/claude-sonnet-5': c(2.675, 13.3749),
        'deepinfra|deepseek-ai/deepseek-r1-0528': c(0.4458, 1.9171),
        'deepinfra|deepseek-ai/deepseek-v3.2': c(0.2318, 0.3388),
        'deepinfra|deepseek-ai/deepseek-v4-flash': c(0.0802, 0.1605),
        'deepinfra|deepseek-ai/deepseek-v4-flash-0731': c(0.0535, 0.1605),
        'deepinfra|deepseek-ai/deepseek-v4-pro': c(1.1592, 2.3183),
        'deepinfra|google/gemini-2.5-flash': c(0.2675, 2.2292),
        'deepinfra|google/gemma-4-31b-it': c(0.1783, 0.3567),
        'deepinfra|meta-llama/llama-3.3-70b-instruct-turbo': c(0.0892, 0.2853),
        'deepinfra|meta-llama/llama-4-scout-17b-16e-instruct': c(0.0892, 0.2675),
        'deepinfra|meta-llama/meta-llama-3.1-8b-instruct-turbo': c(0.0178, 0.0357),
        'deepinfra|microsoft/phi-4': c(0.0624, 0.1248),
        'deepinfra|mistralai/mistral-nemo-instruct-2407': c(0.0259, 0.0267),
        'deepinfra|mistralai/mistral-small-3.2-24b-instruct-2506': c(0.0669, 0.1783),
        'deepinfra|moonshotai/kimi-k2.6': c(0.6687, 3.1208),
        'deepinfra|moonshotai/kimi-k3': c(2.5412, 12.7062),
        'deepinfra|qwen/qwen3-235b-a22b-instruct-2507': c(0.0802, 0.4904),
        'deepinfra|qwen/qwen3-32b': c(0.0713, 0.2497),
        'deepinfra|qwen/qwen3.5-397b-a17b': c(0.4012, 2.675),
        'deepinfra|qwen/qwen3.6-27b': c(0.2853, 2.8533),
        'deepseek|deepseek-flash': c(0.2675, 1.07),
        'deepseek|deepseek-v4-pro': c(1.177, 3.531),
        'gemini|gemini-2.5-flash': c(0.2675, 2.2292),
        'gemini|gemini-2.5-flash-lite': c(0.0892, 0.3567),
        'gemini|gemini-2.5-pro': c(1.1146, 8.9166),
        'gemini|gemini-3-flash-preview': c(0.4458, 2.675),
        'gemini|gemini-3.1-flash-lite': c(0.2229, 1.3375),
        'gemini|gemini-3.1-pro-preview': c(1.7833, 10.7),
        'gemini|gemini-3.5-flash-lite': c(0.2675, 2.2292),
        'gemini|gemini-3.6-flash': c(0.6687, 3.3437),
        'gemini|gemini-3.8-flash': c(0.6687, 3.3437),
        'gemini|gemini-4-argon': c(1.7833, 8.9166),
        'groq|openai/gpt-oss-120b': c(0.1337, 0.535),
        'groq|openai/gpt-oss-20b': c(0.0669, 0.2675),
        'groq|openai/gpt-oss-safeguard-20b': c(0.0669, 0.2675),
        'groq|qwen/qwen3.8-27b': c(0.7133, 3.5667),
        'mistral|codestral': c(0.2675, 0.8025, true),
        'mistral|ministral-3-14b': c(0.1783, 0.1783, true),
        'mistral|ministral-3-3b': c(0.0892, 0.0892, true),
        'mistral|ministral-3-8b': c(0.1337, 0.1337, true),
        'mistral|mistral-large-3': c(0.4458, 1.3375, true),
        'mistral|mistral-large-4-0': c(1.2127, 3.7272, true),
        'mistral|mistral-medium-3-5': c(1.3375, 6.6875),
        'mistral|mistral-small-2603': c(0.1337, 0.535),
        'openai|chat-latest': c(4.4583, 26.7499),
        'openai|gpt-3.5-turbo': c(0.4458, 1.3375),
        'openai|gpt-4-turbo-2024-04-09': c(8.9166, 26.7499),
        'openai|gpt-4.1': c(1.7833, 7.1333),
        'openai|gpt-4.1-mini': c(0.3567, 1.4267),
        'openai|gpt-4.1-nano': c(0.0892, 0.3567),
        'openai|gpt-4o': c(2.2292, 8.9166),
        'openai|gpt-4o-mini': c(0.1337, 0.535),
        'openai|gpt-5': c(1.1146, 8.9166),
        'openai|gpt-5-mini': c(0.2229, 1.7833),
        'openai|gpt-5-nano': c(0.0446, 0.3567),
        'openai|gpt-5-pro': c(13.3749, 106.9996),
        'openai|gpt-5.1': c(1.1146, 8.9166),
        'openai|gpt-5.2': c(1.5604, 12.4833),
        'openai|gpt-5.2-pro': c(18.7249, 149.7994),
        'openai|gpt-5.4': c(2.2292, 13.3749),
        'openai|gpt-5.4-mini': c(0.6687, 4.0125),
        'openai|gpt-5.4-nano': c(0.1783, 1.1146),
        'openai|gpt-5.4-pro': c(26.7499, 160.4993),
        'openai|gpt-5.5': c(4.4583, 26.7499),
        'openai|gpt-5.5-pro': c(26.7499, 160.4993),
        'openai|gpt-5.6-luna': c(0.1783, 1.07),
        'openai|gpt-5.6-sol': c(3.5667, 17.8333),
        'openai|gpt-5.6-terra': c(1.7833, 10.7),
        'openai|gpt-6-astra': c(8.9166, 44.5831),
        'openai|gpt-6-luna': c(0.0892, 0.4458),
        'openai|gpt-6-sol': c(1.7833, 8.9166),
        'openai|gpt-6.1-sol': c(1.7833, 8.9166),
        'openai|o1': c(13.3749, 53.4998),
        'openai|o1-pro': c(133.7494, 534.9978),
        'openai|o3': c(1.7833, 7.1333),
        'openai|o3-mini': c(0.9808, 3.9233),
        'openai|o3-pro': c(17.8333, 71.333),
        'openai|o4-mini': c(0.9808, 3.9233),
        'openrouter|anthropic/claude-haiku-5.5': c(0.0892, 0.4458),
        'openrouter|anthropic/claude-opus-5.5': c(3.5667, 17.8333),
        'openrouter|anthropic/claude-sonnet-5.5': c(1.7833, 8.9166),
        'openrouter|deepseek/deepseek-v4-flash': c(0.0811, 0.1623),
        'openrouter|deepseek/deepseek-v4-flash-0731': c(0.3923, 1.177),
        'openrouter|deepseek/deepseek-v4.1-flash': c(0.0499, 0.107),
        'openrouter|deepseek/deepseek-v4.1-flash-1017': c(0.2675, 1.07),
        'openrouter|meta/muse-spark-1.3-contributor': c(0.0892, 0.1783),
        'openrouter|minimax/minimax-m3.1-flash:free': c(0.0, 0.0),
        'openrouter|nvidia/nemotron-3-ultra-550b-a55b:free': c(0.0, 0.0),
        'openrouter|openai/gpt-6-luna': c(0.0892, 0.4458),
        'openrouter|stepfun/step-5-preview': c(0.8917, 2.4075),
        'openrouter|tencent/hy3': c(0.1177, 0.4708),
        'openrouter|tencent/hy4-preview': c(0.7436, 2.23),
        'openrouter|xiaomi/mimo-v2.6-flash': c(0.1248, 0.2497),
        'openrouter|z-ai/glm-5.3': c(0.0704, 1.2483),
        'openrouter|z-ai/glm-5.3-flash': c(0.0419, 0.107),
        'ovhcloud|gpt-oss-120b': c(0.08, 0.4),
        'ovhcloud|gpt-oss-20b': c(0.04, 0.15),
        'ovhcloud|meta-llama-3_3-70b-instruct': c(0.67, 0.67),
        'ovhcloud|mistral-nemo-instruct-2407': c(0.13, 0.13),
        'ovhcloud|mistral-small-3.2-24b-instruct-2506': c(0.09, 0.28),
        'ovhcloud|qwen2.5-vl-72b-instruct': c(0.91, 0.91),
        'ovhcloud|qwen3.5-397b-a17b': c(0.6, 3.6),
        'ovhcloud|qwen3.5-9b': c(0.1, 0.15),
        'ovhcloud|qwen3.6-27b': c(0.4, 2.7),
        'ovhcloud|qwen3.8-27b': c(0.4, 2.7),
        'scaleway|deepseek-v4-flash-0731': c(0.4, 0.8),
        'scaleway|deepseek-v4.1-flash': c(0.6, 1.8),
        'scaleway|gemma-4-26b-a4b-it': c(0.25, 0.5),
        'scaleway|glm-5.2': c(1.8, 5.5),
        'scaleway|glm-5.3': c(1.8, 5.5),
        'scaleway|gpt-oss-120b': c(0.15, 0.6),
        'scaleway|llama-3.3-70b-instruct': c(0.9, 0.9),
        'scaleway|mistral-medium-3.5-128b': c(1.5, 7.5),
        'scaleway|mistral-small-3.2-24b-instruct-2506': c(0.15, 0.35),
        'scaleway|qwen3-235b-a22b-instruct-2507': c(0.75, 2.25),
        'scaleway|qwen3.5-397b-a17b': c(0.6, 3.6),
        'scaleway|qwen3.6-35b-a3b': c(0.25, 1.5),
        'scaleway|qwen3.8-27b': c(0.6, 3.3),
        'together|openai/gpt-oss-120b': c(0.1337, 0.535),
        'xai|grok-4.20-0309-non-reasoning': c(1.1146, 2.2292),
        'xai|grok-4.20-0309-reasoning': c(1.1146, 2.2292),
        'xai|grok-4.20-multi-agent-0309': c(1.1146, 2.2292),
        'xai|grok-4.3': c(1.1146, 2.2292),
        'xai|grok-4.5': c(1.7833, 5.35),
        'xai|grok-4.6': c(1.7833, 5.35),
        'xai|grok-4.7': c(1.7833, 5.35),
        'xai|grok-build-0.1': c(0.8917, 1.7833)
    };

    const key = (engine, model) => engine + '|' + String(model || '').trim().toLowerCase();
    const price = (engine, model, live) => (live ? REALTIME : BATCH)[key(engine, model)] || null;

    const chatPrice = (provider, model) => CHAT[key(provider, model)] || null;

    // "0,16 €/h", "0,015 €/h" or "0,0096 €/h": the exact figure with 2 to 4 decimals, trailing zeros dropped.
    // "ca. 0,40 €/h" for a calculated figure, '' when no price is known.
    function number(eur) {
        if (eur === 0) return '0';
        let text = eur.toFixed(4).replace(/0+$/, '');
        const decimals = text.length - text.indexOf('.') - 1;
        if (decimals < 2) text += '0'.repeat(2 - decimals);
        return text.replace('.', ',');
    }

    function format(pr) {
        if (!pr) return '';
        return (pr.approx ? 'ca. ' : '') + number(pr.eur) + ' €/h';
    }

    // "0,09 / 0,36 €/M": input / output, euros per 1 million tokens.
    function formatChat(pr) {
        if (!pr) return '';
        return (pr.approx ? 'ca. ' : '') + number(pr.eurIn) + ' / ' + number(pr.eurOut) + ' €/M';
    }

    // The model's name with its price behind it, for the model selects.
    function label(engine, model, name, live) {
        const text = format(price(engine, model, live));
        return text ? name + ' · ' + text : name;
    }

    // The text model's id with its price behind it, for the model selects of the text AI.
    function chatLabel(provider, model) {
        const text = formatChat(chatPrice(provider, model));
        return text ? model + ' · ' + text : model;
    }

    const api = { BATCH, REALTIME, CHAT, price, chatPrice, format, formatChat, label, chatLabel };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) { root.Unisono = root.Unisono || {}; root.Unisono.prices = api; }
})(typeof window !== 'undefined' ? window : null);

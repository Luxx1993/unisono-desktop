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
        'mistral|voxtral-mini-transcribe-realtime-2602': p(0.428, true),
        'gladia|solaria-1': p(0.68)
    };

    const key = (engine, model) => engine + '|' + String(model || '').trim().toLowerCase();
    const price = (engine, model, live) => (live ? REALTIME : BATCH)[key(engine, model)] || null;

    // "0,16 €/h", "0,015 €/h" or "0,0096 €/h": the exact figure with 2 to 4 decimals, trailing zeros dropped.
    // "ca. 0,40 €/h" for a calculated figure, '' when no price is known.
    function format(pr) {
        if (!pr) return '';
        let number = pr.eur.toFixed(4).replace(/0+$/, '');
        const decimals = number.length - number.indexOf('.') - 1;
        if (decimals < 2) number += '0'.repeat(2 - decimals);
        return (pr.approx ? 'ca. ' : '') + number.replace('.', ',') + ' €/h';
    }

    // The model's name with its price behind it, for the model selects.
    function label(engine, model, name, live) {
        const text = format(price(engine, model, live));
        return text ? name + ' · ' + text : name;
    }

    const api = { BATCH, REALTIME, price, format, label };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) { root.Unisono = root.Unisono || {}; root.Unisono.prices = api; }
})(typeof window !== 'undefined' ? window : null);

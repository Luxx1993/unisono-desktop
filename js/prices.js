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
        'openrouter|openai/whisper-large-v3-turbo': p(0.01),
        'openrouter|openai/whisper-large-v3': p(0.03),
        'openrouter|nvidia/parakeet-tdt-0.6b-v3': p(0.08),
        'openrouter|microsoft/mai-transcribe-2': p(0.09),
        'groq|whisper-large-v3-turbo': p(0.04),
        'groq|whisper-large-v3': p(0.10),
        'ovhcloud|whisper-large-v3-turbo': p(0.05),
        'ovhcloud|whisper-large-v3': p(0.15),
        'scaleway|whisper-large-v3': p(0.18),
        'together|openai/whisper-large-v3': p(0.08),
        'together|nvidia/parakeet-tdt-0.6b-v3': p(0.08),
        'xai|grok-voice-transcribe-2.0': p(0.09, true),
        'soniox|stt-async-v5': p(0.09),
        'azure|mai-transcribe-2': p(0.09),
        'azure|mai-transcribe-1.5': p(0.32),
        'assembly|universal-2': p(0.13),
        'assembly|universal-3-5-pro': p(0.19),
        'assembly|universal-3-5-pro-sync': p(0.40, true),
        'gladia|solaria-3': p(0.16),
        'gladia|solaria-1': p(0.27),
        'openai|gpt-transcribe': p(0.24, true),
        'openai|gpt-4o-transcribe-diarize': p(0.32),
        'mistral|voxtral-mini-latest': p(0.19, true),
        'mistral|voxtral-mini-transcribe-3-0': p(0.19),
        'mistral|voxtral-small-transcribe-3-0': p(0.21),
        'elevenlabs|scribe_v2': p(0.20),
        'deepgram|nova-3': p(0.23),
        'gemini|gemini-3.5-transcribe': p(0.27, true),
        'gemini|gemini-3.6-flash': p(0.23, true),
        'gemini|gemini-3.8-flash': p(0.23, true),
        'gemini|gemini-3.5-flash-lite': p(0.06, true)
    };

    // Live transcription, which providers usually bill higher than files.
    const REALTIME = {
        'soniox|stt-rt-v5': p(0.11),
        'assembly|universal-streaming-english': p(0.13),
        'assembly|universal-streaming-multilingual': p(0.13),
        'assembly|universal-3-6-pro': p(0.40),
        'xai|grok-voice-transcribe-2.0': p(0.18),
        'deepgram|nova-2': p(0.31),
        'deepgram|nova-3': p(0.41, true),
        'deepgram|flux-general-en': p(0.35, true),
        'deepgram|flux-general-multi': p(0.35, true),
        'elevenlabs|scribe_v2_realtime': p(0.35),
        'mistral|voxtral-mini-transcribe-realtime-3-0': p(0.43),
        'mistral|voxtral-mini-transcribe-realtime-2602': p(0.43, true),
        'gladia|solaria-1': p(0.68)
    };

    const key = (engine, model) => engine + '|' + String(model || '').trim().toLowerCase();
    const price = (engine, model, live) => (live ? REALTIME : BATCH)[key(engine, model)] || null;

    // "0,160 €/h" (2 to 4 decimals by amount), "ca. 0,400 €/h", or '' when no price is known.
    function format(pr) {
        if (!pr) return '';
        return (pr.approx ? 'ca. ' : '') + pr.eur.toFixed(pr.eur >= 1 ? 2 : pr.eur >= 0.1 ? 3 : 4).replace('.', ',') + ' €/h';
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

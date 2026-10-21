/* Tests for the pure parts of js/apis/realtime.js. Run with:  node tests/realtime.test.js */
const assert = require('node:assert/strict');
const rt = require('../js/apis/realtime.js');

let failed = 0;
function test(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (err) { failed += 1; console.log('FAIL ' + name + '\n     ' + err.message); }
}

test('downsample 48 kHz → 16 kHz keeps a third of the samples and averages them', () => {
    const input = Float32Array.from([0, 0.3, 0.6, 1, 1, 1]);
    const out = rt.downsample(input, 48000);
    assert.equal(out.length, 2);
    assert.ok(Math.abs(out[0] - 0.3) < 1e-6);
    assert.equal(out[1], 1);
});

test('downsample at 16 kHz returns the samples unchanged', () => {
    assert.deepEqual([...rt.downsample(Float32Array.from([0.5, -0.5]), 16000)], [0.5, -0.5]);
});

test('toPcm16 clips and scales', () => {
    assert.deepEqual([...rt.toPcm16([2, -2, 0, 0.5])], [32767, -32768, 0, 16383]);
});

test('base64 of PCM16 is little-endian bytes', () => {
    assert.equal(rt.base64(new Int16Array([1, 256])), Buffer.from([1, 0, 0, 1]).toString('base64'));
});

test('transcript: settled parts plus the current guess, guess replaced, flushed at the end', () => {
    const t = rt.transcript();
    t.guess('Hallo');
    t.guess('Hallo das');
    assert.equal(t.text(), 'Hallo das');
    assert.equal(t.final(), '');
    t.settle('Hallo, das ist gut');
    t.guess('und');
    assert.equal(t.text(), 'Hallo, das ist gut und');
    t.settle('.');
    assert.equal(t.final(), 'Hallo, das ist gut.');
    t.guess('Ende');
    t.flush();
    assert.equal(t.final(), 'Hallo, das ist gut. Ende');
});

test('Deepgram URL: Nova-3 with "auto" uses multi and key terms, EU host on request', () => {
    const url = new URL(rt.deepgramUrl({ model: 'nova-3', language: 'auto', vocabulary: ['Unisono', 'Kaya'], eu: true }));
    assert.equal(url.origin, 'wss://api.eu.deepgram.com');
    assert.equal(url.pathname, '/v1/listen');
    assert.equal(url.searchParams.get('language'), 'multi');
    assert.equal(url.searchParams.get('encoding'), 'linear16');
    assert.equal(url.searchParams.get('sample_rate'), '16000');
    assert.deepEqual(url.searchParams.getAll('keyterm'), ['Unisono', 'Kaya']);
});

test('Deepgram URL: Flux speaks v2 with a language hint only for the multilingual model', () => {
    const multi = new URL(rt.deepgramUrl({ model: 'flux-general-multi', language: 'de' }));
    assert.equal(multi.pathname, '/v2/listen');
    assert.equal(multi.searchParams.get('language_hint'), 'de');
    assert.equal(multi.searchParams.get('interim_results'), null);
    const en = new URL(rt.deepgramUrl({ model: 'flux-general-en', language: 'de' }));
    assert.equal(en.searchParams.get('language_hint'), null);
});

test('ElevenLabs URL carries the single-use token, PCM 16 kHz and the language', () => {
    const url = new URL(rt.elevenLabsUrl({ model: 'scribe_v2_realtime', language: 'de-DE', token: 'abc' }));
    assert.equal(url.searchParams.get('token'), 'abc');
    assert.equal(url.searchParams.get('audio_format'), 'pcm_16000');
    assert.equal(url.searchParams.get('language_code'), 'de');
    assert.equal(new URL(rt.elevenLabsUrl({ model: 'm', language: 'auto', token: 't' })).searchParams.get('language_code'), null);
});

test('Mistral: URL with model, session.update with PCM format, audio as input_audio.append', () => {
    assert.equal(rt.mistralUrl('voxtral-mini-transcribe-realtime-2602'), 'wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=voxtral-mini-transcribe-realtime-2602');
    assert.deepEqual(rt.mistralSessionUpdate(), { type: 'session.update', session: { audio_format: { encoding: 'pcm_s16le', sample_rate: 16000 } } });
    assert.equal(rt.mistralSessionUpdate(480).session.target_streaming_delay_ms, 480);
    assert.deepEqual(rt.mistralAudio(new Int16Array([1, 256])), { type: 'input_audio.append', audio: Buffer.from([1, 0, 0, 1]).toString('base64') });
});

test('Gladia: init body asks for 16 kHz PCM, partials, one fixed language and the vocabulary; EU region in the address', () => {
    assert.equal(rt.GLADIA_INIT_URL, 'https://api.gladia.io/v2/live?region=eu-west');
    const body = rt.gladiaInit({ language: 'de-DE', vocabulary: ['Unisono', '', 'Kaya'] });
    assert.deepEqual([body.encoding, body.bit_depth, body.sample_rate, body.channels, body.model], ['wav/pcm', 16, 16000, 1, 'solaria-1']);
    assert.deepEqual(body.language_config, { languages: ['de'], code_switching: false });
    assert.equal(body.messages_config.receive_partial_transcripts, true);
    assert.deepEqual(body.realtime_processing.custom_vocabulary_config.vocabulary, ['Unisono', 'Kaya']);
    const auto = rt.gladiaInit({ language: 'auto' });
    assert.deepEqual(auto.language_config.languages, []);
    assert.equal(auto.realtime_processing, undefined);
});

if (failed) { console.log(`${failed} test(s) failed`); process.exit(1); }
console.log('all passed');

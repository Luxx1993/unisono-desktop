/* Tests for js/prices.js. Run with:  node tests/prices.test.js */
const assert = require('node:assert/strict');
const prices = require('../js/prices.js');

let failed = 0;
function test(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (err) { failed += 1; console.log('FAIL ' + name + '\n     ' + err.message); }
}

test('Solaria-3 costs 0,16 €/h', () => {
    assert.equal(prices.format(prices.price('gladia', 'solaria-3')), '0,16 €/h');
});

test('a calculated price says "ca." and an unknown model shows nothing', () => {
    assert.equal(prices.format(prices.price('assembly', 'universal-3-5-pro-sync')), 'ca. 0,4012 €/h');
    assert.equal(prices.format(prices.price('groq', 'no-such-model')), '');
});

test('live prices are separate from file prices', () => {
    assert.equal(prices.price('gladia', 'solaria-1', true).eur, 0.68);
    assert.equal(prices.price('gladia', 'solaria-1').eur, 0.27);
});

test('the exact figure shows with 2 to 4 decimals and no trailing zeros', () => {
    assert.equal(prices.format(prices.price('groq', 'whisper-large-v3-turbo')), '0,0357 €/h');
    assert.equal(prices.format(prices.price('openrouter', 'openai/whisper-large-v3-turbo')), '0,0096 €/h');
    assert.equal(prices.format({ eur: 0.1 }), '0,10 €/h');
    assert.equal(prices.format({ eur: 0.015 }), '0,015 €/h');
});

test('label puts the price behind the name', () => {
    assert.equal(prices.label('gladia', 'solaria-3', 'Solaria-3'), 'Solaria-3 · 0,16 €/h');
    assert.equal(prices.label('custom', 'whisper-1', 'whisper-1'), 'whisper-1');
});

test('text models show input / output per million tokens', () => {
    assert.equal(prices.formatChat(prices.chatPrice('anthropic', 'claude-haiku-5-5')), '0,0892 / 0,4458 €/M');
    assert.equal(prices.formatChat(prices.chatPrice('scaleway', 'gpt-oss-120b')), '0,15 / 0,60 €/M');
    assert.equal(prices.formatChat(prices.chatPrice('openrouter', 'minimax/minimax-m3.1-flash:free')), '0 / 0 €/M');
    assert.equal(prices.chatLabel('groq', 'unknown'), 'unknown');
    assert.equal(prices.chatLabel('openai', 'gpt-6-luna'), 'gpt-6-luna · 0,0892 / 0,4458 €/M');
});

if (failed) { console.log(failed + ' FEHLER'); process.exit(1); }
console.log('Alles gut');

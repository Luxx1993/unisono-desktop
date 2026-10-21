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
    assert.equal(prices.format(prices.price('assembly', 'universal-3-5-pro-sync')), 'ca. 0,40 €/h');
    assert.equal(prices.format(prices.price('groq', 'no-such-model')), '');
});

test('live prices are separate from file prices', () => {
    assert.equal(prices.price('gladia', 'solaria-1', true).eur, 0.68);
    assert.equal(prices.price('gladia', 'solaria-1').eur, 0.27);
});

test('label puts the price behind the name', () => {
    assert.equal(prices.label('gladia', 'solaria-3', 'Solaria-3'), 'Solaria-3 · 0,16 €/h');
    assert.equal(prices.label('custom', 'whisper-1', 'whisper-1'), 'whisper-1');
});

if (failed) { console.log(failed + ' FEHLER'); process.exit(1); }
console.log('Alles gut');

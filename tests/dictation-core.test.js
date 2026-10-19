/* Tests for js/dictation-core.js. Run with:  node tests/dictation-core.test.js */
const assert = require('node:assert/strict');
const core = require('../js/dictation-core.js');

let failed = 0;
function test(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (err) { failed += 1; console.log('FAIL ' + name + '\n     ' + err.message); }
}

test('five built-in styles with the app wording', () => {
    assert.deepEqual(core.BUILT_IN_STYLES.map(s => s.name), ['Aufräumen', 'Wörtlich', 'E-Mail', 'Chat', 'Aktenvermerk']);
    assert.ok(core.BUILT_IN_STYLES.every(s => s.prompt.length > 80));
});

test('system prompt carries the task and the terms', () => {
    const p = core.buildSystemPrompt('Mach es kurz.', ['Brandschott', 'Fa. Müller']);
    assert.match(p, /Aufgabe: Mach es kurz\./);
    assert.match(p, /Brandschott, Fa\. Müller/);
    assert.doesNotMatch(core.buildSystemPrompt('x', []), /Fachbegriffe/);
});

test('model output: tags, fences and quotes are taken off', () => {
    assert.equal(core.cleanModelOutput('  <diktat>\nHallo Welt\n</diktat> '), 'Hallo Welt');
    assert.equal(core.cleanModelOutput('```\nHallo\n```'), 'Hallo');
    assert.equal(core.cleanModelOutput('„Hallo Welt“'), 'Hallo Welt');
    assert.equal(core.cleanModelOutput('"Hallo Welt"'), 'Hallo Welt');
    // quotes inside the text stay
    assert.equal(core.cleanModelOutput('Er sagte „ja“ und ging.'), 'Er sagte „ja“ und ging.');
    assert.equal(core.cleanModelOutput('„A“ und „B“'), '„A“ und „B“');
});

test('replacements: whole word, case, order', () => {
    const rules = [
        { from: 'kaffe', to: 'Kaffee', wholeWord: true, matchCase: false },
        { from: 'ca', to: 'circa', wholeWord: true, matchCase: true }
    ];
    assert.equal(core.applyReplacements('Kaffe und ca 5 Kaffeemaschinen, Ca nicht.', rules), 'Kaffee und circa 5 Kaffeemaschinen, Ca nicht.');
});

test('replacements: substring mode and case-insensitive by default', () => {
    assert.equal(core.applyReplacements('Mueller und mueller', [{ from: 'ue', to: 'ü', wholeWord: false, matchCase: false }]), 'Müller und müller');
});

test('replacements: umlauts count as letters for whole words', () => {
    assert.equal(core.applyReplacements('für Fürst', [{ from: 'für', to: 'FÜR', wholeWord: true, matchCase: true }]), 'FÜR Fürst');
});

test('replacements: special characters are literal, "$" in the target too', () => {
    assert.equal(core.applyReplacements('Kosten (netto) 5.', [{ from: '(netto)', to: '$&', wholeWord: false, matchCase: true }]), 'Kosten $& 5.');
    assert.equal(core.applyReplacements('a.b', [{ from: '.', to: '-', wholeWord: false, matchCase: true }]), 'a-b');
});

test('replacements: empty "from" is skipped, empty "to" deletes', () => {
    assert.equal(core.applyReplacements('abc', [{ from: '  ', to: 'x' }]), 'abc');
    // the pattern is trimmed; an empty target deletes the word
    assert.equal(core.applyReplacements('also gut', [{ from: 'also ', to: '', wholeWord: true }]), ' gut');
});

test('sanitizeRules fills defaults', () => {
    assert.deepEqual(core.sanitizeRules([{ from: 'a', to: 'b' }, null, 5]), [{ from: 'a', to: 'b', wholeWord: true, matchCase: false }]);
    assert.deepEqual(core.sanitizeRules('x'), []);
});

test('custom styles: invalid ones are dropped, ids are new', () => {
    const custom = core.sanitizeCustomStyles([{ id: 'custom-1', name: ' SMS ', prompt: ' kurz ' }, { id: 'x', name: '', prompt: 'p' }, {}]);
    assert.deepEqual(custom, [{ id: 'custom-1', name: 'SMS', prompt: 'kurz', custom: true }]);
    assert.equal(core.allStyles(custom).length, 6);
    assert.equal(core.findStyle('custom-1', custom).name, 'SMS');
    assert.equal(core.findStyle('nope', custom), null);
    assert.notEqual(core.newStyleId(custom), 'custom-1');
});

test('history: newest first, capped, removable', () => {
    let list = [];
    for (let i = 0; i < 60; i++) list = core.addToHistory(list, { id: 'h' + i, text: 't' + i });
    assert.equal(list.length, core.HISTORY_MAX);
    assert.equal(list[0].id, 'h59');
    assert.equal(core.removeFromHistory(list, 'h59').length, core.HISTORY_MAX - 1);
    assert.deepEqual(core.sanitizeHistory([{ id: 'a', text: 'x', at: '5' }, { id: 1 }]), [
        { id: 'a', at: 5, style: 'raw', styleName: '', raw: '', text: 'x', seconds: 0 }
    ]);
});

test('word count and segment join', () => {
    assert.equal(core.wordCount('  zwei   Wörter '), 2);
    assert.equal(core.wordCount(''), 0);
    assert.equal(core.joinSegments([{ text: ' Hallo ' }, { text: '' }, { text: 'Welt\n' }]), 'Hallo Welt');
});

if (failed) { console.log(`\n${failed} Test(s) fehlgeschlagen.`); process.exit(1); }
console.log('\nAlle Tests bestanden.');

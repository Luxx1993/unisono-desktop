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
        { id: 'a', at: 5, style: 'raw', styleName: '', raw: '', text: 'x', seconds: 0, kind: 'dictation', instruction: '' }
    ]);
});

test('word count and segment join', () => {
    assert.equal(core.wordCount('  zwei   Wörter '), 2);
    assert.equal(core.wordCount(''), 0);
    assert.equal(core.joinSegments([{ text: ' Hallo ' }, { text: '' }, { text: 'Welt\n' }]), 'Hallo Welt');
});

test('model output: <text> tags of the rewording are taken off', () => {
    assert.equal(core.cleanModelOutput('<text>\nKurz.\n</text>'), 'Kurz.');
});

test('rewording prompt: text and instruction in their tags, terms optional', () => {
    const u = core.buildRewordUser('Das ist ein langer Text.', '  kürzer  ');
    assert.match(u, /<text>\nDas ist ein langer Text\.\n<\/text>/);
    assert.match(u, /<anweisung>\nkürzer\n<\/anweisung>/);
    assert.match(core.buildRewordSystem(['Müller']), /Müller/);
    assert.doesNotMatch(core.buildRewordSystem([]), /Fachbegriffe/);
    assert.ok(core.REWORD_SUGGESTIONS.length >= 4);
});

test('long dictation: cuts only after speech, a long enough part and a long enough pause', () => {
    const cut = (chunkSeconds, silenceSeconds, hadSpeech = true) => core.shouldCut({ chunkSeconds, silenceSeconds, hadSpeech });
    assert.equal(cut(30, 2, false), false);       // nothing said yet
    assert.equal(cut(10, 3), false);              // too short a part
    assert.equal(cut(30, 0.5), false);            // pause too short
    assert.equal(cut(30, 1.0), true);
    assert.equal(cut(95, 0.4), true);             // a very long part is cut at the first short pause
    assert.equal(cut(95, 0.2), false);
    assert.equal(core.shouldCut({ chunkSeconds: 4, silenceSeconds: 1, hadSpeech: true }, { ...core.CHUNK, minSeconds: 3 }), true);
});

test('long dictation: texts of the parts join into one', () => {
    assert.equal(core.joinChunkTexts([' Erster Teil. ', '', 'Zweiter  Teil.']), 'Erster Teil. Zweiter Teil.');
    assert.equal(core.joinChunkTexts(null), '');
});

test('statistics: counters, streak and week', () => {
    const day = 20000;
    let st = core.emptyStats();
    st = core.recordDictation(st, 'eins zwei drei', 6, day, 1000);
    assert.deepEqual([st.dictations, st.words, st.chars, st.spokenSeconds, st.streakCurrent, st.firstUse], [1, 3, 14, 6, 1, 1000]);
    st = core.recordDictation(st, 'vier fünf', 4, day, 2000);
    assert.deepEqual([st.dictations, st.words, st.streakCurrent, st.firstUse], [2, 5, 1, 1000]);
    st = core.recordDictation(st, 'sechs', 2, day + 1);
    assert.equal(st.streakCurrent, 2);
    assert.equal(st.streakBest, 2);
    st = core.recordDictation(st, 'sieben', 2, day + 5);
    assert.equal(st.streakCurrent, 1);
    assert.equal(st.streakBest, 2);
    assert.equal(core.currentStreak(st, day + 5), 1);
    assert.equal(core.currentStreak(st, day + 7), 0);
    const week = core.activity(st, day + 5);
    assert.equal(week.length, 7);
    assert.equal(week[6].words, 1);
    assert.equal(week[2].words, 1);   // day + 1
    assert.equal(week[1].words, 5);   // day
    assert.equal(week[0].words, 0);
});

test('statistics: blank text counts for nothing, old days drop out', () => {
    const st = core.emptyStats();
    assert.equal(core.recordDictation(st, '   ', 5), st);
    let s2 = core.recordDictation(st, 'a b', 1, 100);
    s2 = core.recordDictation(s2, 'c', 1, 120);
    assert.deepEqual(Object.keys(s2.daily), ['120']);
});

test('statistics: time saved against typing, never negative', () => {
    assert.equal(core.savedSeconds(40, 0), 60);
    assert.equal(core.savedSeconds(40, 20), 40);
    assert.equal(core.savedSeconds(10, 600), 0);
});

test('statistics: month counter restarts with a new month', () => {
    const jan = Math.floor(Date.UTC(2026, 0, 15) / 86400000);
    const feb = Math.floor(Date.UTC(2026, 1, 3) / 86400000);
    let st = core.recordDictation(core.emptyStats(), 'a b c', 1, jan);
    assert.equal(core.wordsThisMonth(st, jan), 3);
    assert.equal(core.wordsThisMonth(st, feb), 0);
    st = core.recordDictation(st, 'd e', 1, feb);
    assert.equal(core.wordsThisMonth(st, feb), 2);
});

test('statistics: rewordings count, bad stored data is repaired', () => {
    assert.equal(core.recordRewording(core.emptyStats()).rewordings, 1);
    const fixed = core.sanitizeStats({ dictations: '4', words: -2, daily: { 5: 3, x: 1, 6: 0 }, bogus: 1 });
    assert.equal(fixed.dictations, 4);
    assert.equal(fixed.words, 0);
    assert.deepEqual(fixed.daily, { 5: 3 });
    assert.deepEqual(core.sanitizeStats(null), core.emptyStats());
});

test('epochDay follows the local calendar day', () => {
    assert.equal(core.epochDay(new Date(2026, 9, 19, 23, 59)), core.epochDay(new Date(2026, 9, 19, 0, 1)));
    assert.equal(core.epochDay(new Date(2026, 9, 20)) - core.epochDay(new Date(2026, 9, 19)), 1);
});

if (failed) { console.log(`\n${failed} Test(s) fehlgeschlagen.`); process.exit(1); }
console.log('\nAlle Tests bestanden.');

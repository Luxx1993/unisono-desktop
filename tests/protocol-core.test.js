/* Tests for js/protocol-core.js. Run with:  node tests/protocol-core.test.js */
const assert = require('node:assert/strict');
const core = require('../js/protocol-core.js');

let failed = 0;
function test(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (err) { failed += 1; console.log('FAIL ' + name + '\n     ' + err.message); }
}

test('templates: four protocol templates besides the summaries', () => {
    assert.deepEqual(core.TEMPLATES.filter(t => t.group === 'protocol').map(t => t.id), ['baubesprechung', 'begehung', 'telefonnotiz', 'aktenvermerk']);
    assert.equal(core.findTemplate('nope').id, 'bullets');
});

test('prompt carries the context: project, named speakers only, people with role, markers', () => {
    const p = core.buildPrompt('baubesprechung', 'A: Hallo', {
        project: 'Kita Lindenstraße', date: '20.10.2026', speakers: ['Frau Kaya', 'Sprecher B'],
        people: [{ name: 'Frau Kaya', role: 'Bauherrin' }, { name: 'Herr Roth', role: '' }], markers: [{ time: '00:12:03', label: 'Riss Treppenhaus' }]
    });
    assert.match(p, /Baubesprechung/);
    assert.match(p, /Projekt: Kita Lindenstraße/);
    assert.match(p, /Sprecher im Transkript: Frau Kaya\n/);
    assert.match(p, /Frau Kaya \(Bauherrin\), Herr Roth/);
    assert.match(p, /00:12:03 Riss Treppenhaus/);
    assert.match(p, /<transcript>\nA: Hallo\n<\/transcript>$/);
});

test('prompt without context has no context block', () => {
    assert.doesNotMatch(core.buildPrompt('summary', 'x', {}), /<kontext>/);
});

test('parseTasks reads a fenced JSON answer and German or English keys', () => {
    const tasks = core.parseTasks('Hier:\n```json\n[{"aufgabe":"Angebot schicken","verantwortlich":"Roth","frist":"2026-11-03"},{"task":"Plan prüfen","owner":"","due":"nächste Woche"},{"aufgabe":""}]\n```');
    assert.deepEqual(tasks, [
        { text: 'Angebot schicken', owner: 'Roth', due: '2026-11-03' },
        { text: 'Plan prüfen', owner: '', due: 'nächste Woche' }
    ]);
    assert.deepEqual(core.parseTasks('[]'), []);
    assert.throws(() => core.parseTasks('Keine Aufgaben.'), /keine Aufgabenliste/);
});

test('mergeTasks drops tasks already listed and duplicates in the answer', () => {
    const merged = core.mergeTasks([{ text: 'Angebot  schicken' }], [{ text: 'angebot schicken' }, { text: 'Plan prüfen' }, { text: 'Plan prüfen ' }]);
    assert.deepEqual(merged.map(t => t.text), ['Plan prüfen']);
});

test('Markdown table and CSV for Excel', () => {
    const tasks = [{ text: 'A | B', owner: 'Roth', due: '2026-11-03', done: true }, { text: 'Plan "prüfen"', owner: '', due: 'bald', done: false }];
    const md = core.tasksToMarkdown(tasks);
    assert.match(md, /\| ✓ \| A \\\| B \| Roth \| 03\.11\.2026 \|/);
    const csv = core.tasksToCsv(tasks);
    assert.ok(csv.startsWith('﻿"Erledigt";"Aufgabe"'));
    assert.match(csv, /"nein";"Plan ""prüfen""";"";"bald"/);
    assert.equal(core.tasksToMarkdown([]), '');
});

test('selfSpeaker: the speaker talking while the own microphone is louder is "Ich"', () => {
    // 10 s at 0.2 s steps: 0–4 s own mic loud, 4–10 s meeting loud
    const mic = [], tab = [];
    for (let i = 0; i < 50; i++) { const own = i < 20; mic.push(own ? 0.2 : 0.02); tab.push(own ? 0.03 : 0.25); }
    const timeline = { step: 0.2, mic, tab };
    const segments = [
        { speaker: 'A', start: 0, end: 4 },
        { speaker: 'B', start: 4, end: 7 },
        { speaker: 'C', start: 7, end: 10 }
    ];
    assert.equal(core.selfSpeaker(segments, timeline), 'A');
    assert.equal(core.selfSpeaker([{ speaker: 'B', start: 4, end: 10 }], timeline), null);
    assert.equal(core.selfSpeaker(segments, null), null);
    assert.equal(core.selfSpeaker([{ speaker: null, start: 0, end: 4 }], timeline), null);
});

if (failed) { console.log(`${failed} test(s) failed`); process.exit(1); }
console.log('all passed');

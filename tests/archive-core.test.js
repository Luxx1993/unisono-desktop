/* Tests for js/archive-core.js. Run with:  node tests/archive-core.test.js */
const assert = require('node:assert/strict');
const core = require('../js/archive-core.js');

let failed = 0;
function test(name, fn) {
    try { fn(); console.log('ok   ' + name); } catch (err) { failed += 1; console.log('FAIL ' + name + '\n     ' + err.message); }
}

const project = {
    format: 'unisono', version: 1, fileName: 'Baubesprechung 12.mp3', provider: 'gladia', createdAt: '2026-10-03T09:00:00.000Z',
    speakers: [{ id: 'A', name: 'Frau Kaya' }, { id: 'B', name: 'Sprecher B' }],
    segments: [
        { speaker: 'A', start: 0, end: 12.5, text: 'Guten Morgen zusammen.' },
        { speaker: 'B', start: 12.5, end: 61, text: 'Der Estrich ist noch nicht trocken.' }
    ],
    markers: [], summary: '', raw: null
};

test('entry figures come from the segments', () => {
    const e = core.entryFromProject(project, { id: 'x', savedAt: '2026-10-04T00:00:00.000Z' });
    assert.equal(e.title, 'Baubesprechung 12');
    assert.equal(e.seconds, 61);
    assert.equal(e.words, 9);
    assert.equal(e.speakers, 2);
    assert.equal(e.createdAt, '2026-10-03T09:00:00.000Z');
    assert.equal(e.updatedAt, '2026-10-04T00:00:00.000Z');
    assert.match(e.preview, /^Guten Morgen/);
});

test('title without a file name', () => {
    assert.equal(core.titleOf(null), 'Transkript');
    assert.equal(core.titleOf('aufnahme.webm'), 'aufnahme');
});

test('search looks at title, text and speaker names, every word must match', () => {
    const e = core.entryFromProject(project, { id: 'x' });
    assert.ok(core.matches(e, ''));
    assert.ok(core.matches(e, 'estrich'));
    assert.ok(core.matches(e, 'kaya baubesprechung'));
    assert.ok(!core.matches(e, 'estrich dach'));
});

test('stats over all entries, this month and per engine', () => {
    const a = core.entryFromProject(project, { id: 'a' });
    const b = core.entryFromProject({ ...project, provider: 'elevenlabs', createdAt: '2026-09-20T10:00:00.000Z' }, { id: 'b' });
    const c = core.entryFromProject({ ...project, provider: 'elevenlabs', createdAt: '2026-10-10T10:00:00.000Z' }, { id: 'c' });
    const st = core.stats([a, b, c], new Date('2026-10-19T12:00:00'));
    assert.equal(st.count, 3);
    assert.equal(st.seconds, 183);
    assert.equal(st.words, 27);
    assert.equal(st.monthCount, 2);
    assert.equal(st.byProvider[0].id, 'elevenlabs');
    assert.equal(st.byProvider[0].count, 2);
});

test('project from a background transcription names the speakers', () => {
    const p = core.projectFromResult({ provider: 'gladia', fileName: 'x.webm', segments: [{ speaker: 'B', start: 0, end: 1, text: ' Hallo ' }, { speaker: null, start: 1, end: 2, text: 'ja' }] });
    assert.equal(p.format, 'unisono');
    assert.deepEqual(p.speakers, [{ id: 'B', name: 'Sprecher B' }]);
    assert.equal(p.segments[0].text, 'Hallo');
});

test('network errors are told apart from provider errors', () => {
    assert.ok(core.isNetworkError(new TypeError('Failed to fetch')));
    assert.ok(!core.isNetworkError(new Error('Gladia: HTTP 401 – invalid key')));
    assert.ok(!core.isNetworkError(null));
});

if (failed) { console.log(`\n${failed} Test(s) fehlgeschlagen.`); process.exit(1); }
console.log('\nAlle Tests bestanden.');

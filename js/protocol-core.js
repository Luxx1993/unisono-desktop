/*
 * Protocol logic without any DOM: the summary and protocol templates, the task list (reading the
 * AI's answer, Markdown and CSV) and, for meeting recordings, which speaker is "Ich".
 *
 * Kept free of the page so it can be tested with plain Node (tests/protocol-core.test.js).
 * In the browser it is available as Unisono.protocolCore.
 */
(function (root) {
    // ---- Templates ----------------------------------------------------------------------------
    // group: 'summary' (short forms) or 'protocol' (a document with fixed sections).
    const TEMPLATES = [
        { id: 'bullets', group: 'summary', name: 'Stichpunkte',
            prompt: 'Fasse das folgende Transkript in prägnanten Stichpunkten zusammen. Gruppiere nach Themen und nenne Entscheidungen und offene Punkte.' },
        { id: 'summary', group: 'summary', name: 'Zusammenfassung',
            prompt: 'Schreibe eine gut lesbare Zusammenfassung des folgenden Transkripts in wenigen Absätzen. Halte dich an den Inhalt und erfinde nichts hinzu.' },
        { id: 'minutes', group: 'summary', name: 'Protokoll mit Aufgaben',
            prompt: 'Erstelle aus dem folgenden Transkript ein Besprechungsprotokoll mit den Abschnitten: Teilnehmer (soweit erkennbar), Themen, Ergebnisse/Entscheidungen, Aufgaben (Wer? Was? Bis wann?, soweit genannt) und offene Punkte.' },
        { id: 'baubesprechung', group: 'protocol', name: 'Baubesprechung',
            prompt: 'Erstelle aus dem folgenden Transkript ein Protokoll einer Baubesprechung mit diesen Abschnitten:\n'
                + '1. Kopf: Projekt, Datum, Teilnehmer (mit Firma oder Rolle, soweit bekannt)\n'
                + '2. Besprochene Punkte, nummeriert (z. B. 1.1, 1.2), je Punkt: Sachstand, Ergebnis oder Festlegung\n'
                + '3. Termine und Fristen\n'
                + '4. Aufgaben als Tabelle: Nr. | Aufgabe | Verantwortlich | Frist\n'
                + '5. Offene Punkte und Behinderungen, Mehrkosten oder Nachträge, soweit angesprochen\n'
                + 'Schreibe sachlich und knapp im Protokollstil (Präsens, keine wörtliche Rede).' },
        { id: 'begehung', group: 'protocol', name: 'Begehung',
            prompt: 'Erstelle aus dem folgenden Transkript ein Begehungsprotokoll mit diesen Abschnitten:\n'
                + '1. Kopf: Projekt, Datum, Ort, Teilnehmer\n'
                + '2. Feststellungen nach Ort oder Bauteil geordnet; je Feststellung: Ort, Befund, Bewertung (Mangel, Hinweis oder in Ordnung). '
                + 'Wenn Merker im Transkript genannt sind, ordne die Feststellungen ihnen zu.\n'
                + '3. Mängelliste als Tabelle: Nr. | Ort | Mangel | Zuständig | Frist zur Beseitigung\n'
                + '4. Vereinbarungen und nächste Schritte\n'
                + 'Schreibe sachlich und knapp im Protokollstil.' },
        { id: 'telefonnotiz', group: 'protocol', name: 'Telefonnotiz',
            prompt: 'Erstelle aus dem folgenden Transkript eine Telefonnotiz mit: Datum, Gesprächspartner (mit Firma, soweit bekannt), Anlass, '
                + 'Inhalt in wenigen Stichpunkten, Vereinbarungen, Rückrufe oder Aufgaben (Wer? Was? Bis wann?). Höchstens eine halbe Seite.' },
        { id: 'aktenvermerk', group: 'protocol', name: 'Aktenvermerk',
            prompt: 'Erstelle aus dem folgenden Transkript einen Aktenvermerk mit: Betreff, Datum, Beteiligte, Sachverhalt (in ganzen Sätzen, '
                + 'chronologisch, ohne Wertung), Ergebnis oder Vereinbarung, weiteres Vorgehen. Sachlicher Stil, dritte Person, Präsens.' }
    ];
    const findTemplate = id => TEMPLATES.find(t => t.id === id) || TEMPLATES[0];

    // The facts the AI should use instead of guessing: project, date, participants, markers.
    function contextBlock({ project = null, date = null, speakers = [], people = [], markers = [] } = {}) {
        const lines = [];
        if (project) lines.push(`Projekt: ${project}`);
        if (date) lines.push(`Datum der Aufnahme: ${date}`);
        const named = speakers.filter(name => name && !/^Sprecher [A-Z]+$/.test(name));
        if (named.length) lines.push(`Sprecher im Transkript: ${named.join(', ')}`);
        if (people.length) lines.push('Bekannte Personen im Projekt: ' + people.map(p => p.role ? `${p.name} (${p.role})` : p.name).join(', '));
        if (markers.length) lines.push('Merker: ' + markers.map(m => `${m.time} ${m.label}`).join('; '));
        return lines.length ? `<kontext>\n${lines.join('\n')}\n</kontext>\n\n` : '';
    }

    function buildPrompt(templateId, transcript, context) {
        return `${findTemplate(templateId).prompt}\n\n${contextBlock(context)}<transcript>\n${transcript}\n</transcript>`;
    }

    // ---- Tasks --------------------------------------------------------------------------------------
    const TASK_PROMPT = 'Lies das folgende Transkript und liste alle Aufgaben, Zusagen und Vereinbarungen, bei denen jemand etwas tun soll. '
        + 'Antworte nur mit einem JSON-Array, ohne weiteren Text. Jedes Element: '
        + '{"aufgabe": "kurz, mit Verb", "verantwortlich": "Name oder leer", "frist": "JJJJ-MM-TT, wenn ein Datum genannt oder eindeutig ist, sonst der genannte Zeitraum oder leer"}. '
        + 'Nutze für "verantwortlich" die Namen aus dem Kontext, wenn sie passen. Erfinde nichts. Gibt es keine Aufgaben, antworte mit [].';

    function buildTaskPrompt(transcript, context) {
        return `${TASK_PROMPT}\n\n${contextBlock(context)}<transcript>\n${transcript}\n</transcript>`;
    }

    // The AI's answer → [{ text, owner, due }]. Tolerates code fences and text around the array.
    function parseTasks(answer) {
        const s = String(answer || '');
        const start = s.indexOf('[');
        const end = s.lastIndexOf(']');
        if (start < 0 || end < start) throw new Error('Die KI hat keine Aufgabenliste geliefert.');
        let list;
        try { list = JSON.parse(s.slice(start, end + 1)); } catch (_) { throw new Error('Die Aufgabenliste der KI ließ sich nicht lesen.'); }
        if (!Array.isArray(list)) throw new Error('Die KI hat keine Aufgabenliste geliefert.');
        return list.map(item => ({
            text: String(item?.aufgabe ?? item?.task ?? item?.text ?? '').trim(),
            owner: String(item?.verantwortlich ?? item?.owner ?? '').trim(),
            due: String(item?.frist ?? item?.due ?? '').trim()
        })).filter(t => t.text);
    }

    // New tasks without the ones already in the list (same text, ignoring case and spaces).
    function mergeTasks(existing, found) {
        const key = t => t.text.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim();
        const seen = new Set(existing.map(key));
        return found.filter(t => { const k = key(t); if (seen.has(k)) return false; seen.add(k); return true; });
    }

    const isoDate = due => /^\d{4}-\d{2}-\d{2}$/.test(due || '');
    function dueText(due) {
        if (!isoDate(due)) return due || '';
        const [y, m, d] = due.split('-');
        return `${d}.${m}.${y}`;
    }

    function tasksToMarkdown(tasks) {
        if (!tasks.length) return '';
        const cell = s => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
        return ['| Erledigt | Aufgabe | Verantwortlich | Frist |', '|---|---|---|---|',
            ...tasks.map(t => `| ${t.done ? '✓' : ''} | ${cell(t.text)} | ${cell(t.owner)} | ${cell(dueText(t.due))} |`)].join('\n');
    }

    // Semicolons and a BOM: Excel in German settings opens it without an import dialog.
    function tasksToCsv(tasks) {
        const cell = s => `"${String(s || '').replace(/"/g, '""')}"`;
        return '﻿' + [['Erledigt', 'Aufgabe', 'Verantwortlich', 'Frist'],
            ...tasks.map(t => [t.done ? 'ja' : 'nein', t.text, t.owner, dueText(t.due)])]
            .map(row => row.map(cell).join(';')).join('\r\n');
    }

    // ---- Meeting recordings: who is "Ich" ----------------------------------------------------------
    // timeline: { step (seconds), mic: [level], tab: [level] } sampled while recording. The own microphone
    // is "louder than the meeting" while you speak; the speaker who talks most in those moments is you.
    function micShare(segment, timeline) {
        const { step, mic, tab } = timeline;
        const from = Math.max(0, Math.floor(segment.start / step));
        const to = Math.min(mic.length, Math.ceil(segment.end / step));
        let own = 0;
        let voiced = 0;
        for (let i = from; i < to; i++) {
            const m = mic[i] || 0;
            const t = tab[i] || 0;
            if (Math.max(m, t) < 0.01) continue;   // silence
            voiced++;
            if (m > t * 1.5) own++;
        }
        return { own, voiced };
    }

    function selfSpeaker(segments, timeline, { minShare = 0.5 } = {}) {
        if (!timeline?.step || !Array.isArray(timeline.mic) || !Array.isArray(timeline.tab)) return null;
        const per = new Map();
        for (const seg of segments) {
            if (seg.speaker == null || !(seg.end > seg.start)) continue;
            const { own, voiced } = micShare(seg, timeline);
            const p = per.get(seg.speaker) || { own: 0, voiced: 0 };
            p.own += own;
            p.voiced += voiced;
            per.set(seg.speaker, p);
        }
        let best = null;
        for (const [speaker, p] of per) {
            const share = p.voiced ? p.own / p.voiced : 0;
            if (share >= minShare && (!best || share > best.share)) best = { speaker, share };
        }
        return best?.speaker ?? null;
    }

    const api = {
        TEMPLATES, findTemplate, contextBlock, buildPrompt,
        buildTaskPrompt, parseTasks, mergeTasks, dueText, isoDate, tasksToMarkdown, tasksToCsv,
        selfSpeaker
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) {
        root.Unisono = root.Unisono || {};
        root.Unisono.protocolCore = api;
    }
})(typeof window !== 'undefined' ? window : null);

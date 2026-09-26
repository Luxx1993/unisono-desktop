/*
 * Exporters. Everything is built from the current (edited) segments in Scribe.state,
 * so corrected text and speaker names end up in every format.
 *
 *   txt   plain text:        [Herr Müller - 00:01:12]: Text
 *   md    Markdown with YAML frontmatter (Obsidian, Notion, wikis), optional summary
 *   html  standalone page: readable/printable, optional embedded audio with click-to-jump
 *   srt / vtt  subtitles (vtt with speaker voice tags)
 *   json  project file – can be opened again in Scribe Studio to continue editing
 */
window.Scribe = window.Scribe || {};
(function (S) {
    const pad = (n, len = 2) => String(n).padStart(len, '0');

    // 72.4 → '00:01:12'
    function clock(sec) {
        const s = Math.floor(sec);
        return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    }

    // 72.4 → '00:01:12,400' (SRT) or '00:01:12.400' (VTT)
    function cueTime(sec, separator) {
        const ms = Math.round(sec * 1000);
        return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${separator}${pad(ms % 1000, 3)}`;
    }

    function speakerLabel(seg) {
        return seg.speaker != null ? S.state.speakerName(seg.speaker).trim() : '';
    }

    function textSegments() {
        return S.state.get().segments.filter(s => s.text.trim());
    }

    function timedSegments() {
        return textSegments().filter(s => s.end > 0);
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // --- Metadata shared by Markdown and HTML ---
    function meta() {
        const { fileName, provider, createdAt } = S.state.get();
        const segs = textSegments();
        const usedSpeakers = [...new Set(segs.map(speakerLabel).filter(Boolean))];
        const duration = segs.reduce((max, s) => Math.max(max, s.end), 0);
        const date = createdAt ? new Date(createdAt) : new Date();
        return {
            title: baseName(),
            fileName,
            provider: provider ? (S.apis[provider]?.label || provider) : null,
            date,
            dateIso: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
            dateText: date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
            duration: duration > 0 ? clock(duration) : null,
            speakers: usedSpeakers
        };
    }

    // --- Formats ---
    function toText() {
        const withTimes = S.state.hasTimes();
        return textSegments()
            .map(seg => {
                const parts = [speakerLabel(seg), withTimes ? clock(seg.start) : ''].filter(Boolean);
                return parts.length ? `[${parts.join(' - ')}]: ${seg.text.trim()}` : seg.text.trim();
            })
            .join('\n\n');
    }

    function yamlString(value) {
        return JSON.stringify(String(value));  // JSON strings are valid YAML scalars
    }

    function toMarkdown({ includeSummary = true } = {}) {
        const m = meta();
        const withTimes = S.state.hasTimes();
        const summary = includeSummary ? S.summary.getText().trim() : '';

        const front = ['---', `titel: ${yamlString(m.title)}`, `datum: ${m.dateIso}`];
        if (m.fileName) front.push(`quelle: ${yamlString(m.fileName)}`);
        if (m.provider) front.push(`anbieter: ${yamlString(m.provider)}`);
        if (m.duration) front.push(`dauer: "${m.duration}"`);
        if (m.speakers.length) front.push('sprecher:', ...m.speakers.map(s => `  - ${yamlString(s)}`));
        front.push('tags:', '  - transkript', '---');

        const body = [`# ${m.title}`, ''];
        if (summary) body.push('## Zusammenfassung', '', summary, '');
        body.push('## Transkript', '');
        for (const seg of textSegments()) {
            const head = [speakerLabel(seg) && `**${speakerLabel(seg)}**`, withTimes && `\`${clock(seg.start)}\``].filter(Boolean).join(' · ');
            if (head) body.push(head);
            body.push(seg.text.trim(), '');
        }
        return front.join('\n') + '\n\n' + body.join('\n');
    }

    function toSrt() {
        return timedSegments().map((seg, i) => {
            const name = speakerLabel(seg);
            return `${i + 1}\n${cueTime(seg.start, ',')} --> ${cueTime(seg.end, ',')}\n${name ? name + ': ' : ''}${seg.text.trim()}\n`;
        }).join('\n');
    }

    function escapeVtt(text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Speaker names become WebVTT voice tags: <v Herr Müller>Text
    function toVtt() {
        const cues = timedSegments().map(seg => {
            const name = speakerLabel(seg);
            const voice = name ? `<v ${escapeVtt(name)}>` : '';
            return `${cueTime(seg.start, '.')} --> ${cueTime(seg.end, '.')}\n${voice}${escapeVtt(seg.text.trim())}`;
        });
        return 'WEBVTT\n\n' + cues.join('\n\n') + '\n';
    }

    // Project file: everything needed to continue editing later (not the audio itself).
    function toJson() {
        const { fileName, provider, createdAt, speakers, segments, raw } = S.state.get();
        return JSON.stringify({
            format: 'scribe-studio',
            version: 1,
            fileName, provider, createdAt,
            speakers,
            segments: segments.map(({ speaker, start, end, text }) => ({ speaker, start, end, text })),
            summary: S.summary.getText(),
            raw
        }, null, 2);
    }

    // --- Standalone HTML ---
    const SPEAKER_COLORS = ['#0369a1', '#be185d', '#4d7c0f', '#b45309', '#7e22ce', '#047857', '#c2410c', '#b91c1c'];

    function readAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    // Turns a long ASCII string (the base64 data URL) into byte chunks, yielding to the browser
    // between chunks. Encoding 80 MB in one go froze the page for seconds.
    async function asciiChunks(str, size = 4 * 1024 * 1024) {
        const encoder = new TextEncoder();
        const parts = [];
        for (let i = 0; i < str.length; i += size) {
            parts.push(encoder.encode(str.slice(i, i + size)));
            await new Promise(r => setTimeout(r));
        }
        return parts;
    }

    const AUDIO_PLACEHOLDER = '__SCRIBE_AUDIO_SRC__';

    // Returns a string, or a Blob when audio is embedded (assembled from chunks, see above).
    async function toHtml({ includeSummary = true, audioFile = null } = {}) {
        const m = meta();
        const withTimes = S.state.hasTimes();
        const summary = includeSummary ? S.summary.getText().trim() : '';
        const audioSrc = audioFile ? await readAsDataUrl(audioFile) : null;
        const color = seg => {
            const i = S.state.speakerIndex(seg.speaker);
            return i < 0 ? '#64748b' : SPEAKER_COLORS[i % SPEAKER_COLORS.length];
        };

        const facts = [
            ['Datum', m.dateText],
            m.duration && ['Dauer', m.duration],
            m.fileName && ['Quelle', m.fileName],
            m.provider && ['Transkribiert mit', m.provider],
            m.speakers.length && ['Sprecher', m.speakers.join(', ')]
        ].filter(Boolean);

        const segmentsHtml = textSegments().map(seg => {
            const name = speakerLabel(seg);
            const time = withTimes
                ? (audioSrc
                    ? `<button type="button" class="time" data-start="${seg.start}">${clock(seg.start)}</button>`
                    : `<span class="time">${clock(seg.start)}</span>`)
                : '';
            return `<article class="seg" data-start="${seg.start}" data-end="${seg.end}" style="--spk:${color(seg)}">
    <header>${name ? `<span class="who">${escapeHtml(name)}</span>` : ''}${time}</header>
    <p>${escapeHtml(seg.text.trim())}</p>
  </article>`;
        }).join('\n  ');

        const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(m.title)}</title>
<style>
  :root { --ink:#1e293b; --muted:#64748b; --line:#e2e8f0; --paper:#fff; --tint:#f8fafc; --accent:#0369a1; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--tint); color:var(--ink); font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width:52rem; margin:0 auto; padding:2rem 1rem 4rem; }
  h1 { font-size:1.6rem; line-height:1.25; margin:0 0 1rem; text-wrap:balance; }
  h2 { font-size:1rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:2rem 0 .75rem; }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:.25rem 1rem; margin:0; font-size:.9rem; }
  dt { color:var(--muted); } dd { margin:0; }
  .player { position:sticky; top:0; z-index:1; background:var(--tint); padding:.75rem 0; border-bottom:1px solid var(--line); }
  audio { width:100%; }
  .summary { background:var(--paper); border:1px solid var(--line); border-radius:.5rem; padding:1rem 1.25rem; white-space:pre-wrap; font-size:.95rem; }
  .seg { background:var(--paper); border:1px solid var(--line); border-left:4px solid var(--spk); border-radius:.4rem; padding:.6rem .9rem; margin-bottom:.5rem; break-inside:avoid; }
  .seg header { display:flex; gap:.75rem; align-items:baseline; font-size:.8rem; }
  .who { font-weight:600; color:var(--spk); }
  .time { font:inherit; font-family:ui-monospace,Menlo,monospace; color:var(--muted); background:none; border:0; padding:0; }
  button.time { cursor:pointer; text-decoration:underline dotted; }
  button.time:hover, button.time:focus-visible { color:var(--accent); }
  .seg p { margin:.2rem 0 0; }
  .seg.active { background:#f0f9ff; }
  footer { margin-top:2rem; font-size:.8rem; color:var(--muted); }
  @media print {
    body { background:#fff; font-size:11pt; }
    main { padding:0; max-width:none; }
    .player { display:none; }
    .seg { border:0; border-left:3px solid var(--spk); border-radius:0; padding:.2rem .6rem; margin-bottom:.35rem; }
    .summary { border:0; padding:0; }
  }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(m.title)}</h1>
  <dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
  ${audioSrc ? `<div class="player"><audio id="audio" controls preload="metadata" src="${AUDIO_PLACEHOLDER}"></audio></div>` : ''}
  ${summary ? `<h2>Zusammenfassung</h2>\n  <div class="summary">${escapeHtml(summary)}</div>` : ''}
  <h2>Transkript</h2>
  ${segmentsHtml}
  <footer>Erstellt mit Scribe Studio · ${escapeHtml(m.dateText)}</footer>
</main>
${audioSrc ? `<script>
  const audio = document.getElementById('audio');
  const segs = [...document.querySelectorAll('.seg')];
  document.addEventListener('click', e => {
    const t = e.target.closest('button.time');
    if (!t) return;
    audio.currentTime = +t.dataset.start;
    audio.play();
  });
  let active = null;
  audio.addEventListener('timeupdate', () => {
    const now = audio.currentTime;
    const seg = segs.find(s => now >= +s.dataset.start && now < +s.dataset.end) || null;
    if (seg === active) return;
    active?.classList.remove('active');
    active = seg;
    seg?.classList.add('active');
  });
</script>` : ''}
</body>
</html>
`;
        if (!audioSrc) return html;
        const [before, after] = html.split(AUDIO_PLACEHOLDER);
        return new Blob([before, ...(await asciiChunks(audioSrc)), after], { type: 'text/html;charset=utf-8' });
    }

    // --- Download ---
    function baseName() {
        const name = S.state.get().fileName;
        return name ? name.replace(/\.[^.]+$/, '') : 'transkription';
    }

    function download(content, filename, type) {
        const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const FORMATS = {
        txt: { build: toText, ext: 'txt', type: 'text/plain;charset=utf-8' },
        md: { build: toMarkdown, ext: 'md', type: 'text/markdown;charset=utf-8' },
        html: { build: toHtml, ext: 'html', type: 'text/html;charset=utf-8' },
        srt: { build: toSrt, ext: 'srt', type: 'application/x-subrip;charset=utf-8', timed: true },
        vtt: { build: toVtt, ext: 'vtt', type: 'text/vtt;charset=utf-8', timed: true },
        json: { build: toJson, ext: 'scribe.json', type: 'application/json' }
    };

    // options: { includeSummary, audioFile } – used by md and html.
    async function exportAs(format, options = {}) {
        if (!S.state.get().segments.length) return S.ui.setStatus('Noch kein Transkript vorhanden.', 'error');
        const f = FORMATS[format];
        if (f.timed && !timedSegments().length) {
            return S.ui.setStatus(`Keine Zeitstempel vorhanden – ${format.toUpperCase()}-Export nicht möglich.`, 'error');
        }
        if (options.audioFile) S.ui.setStatus('Bette Audio in die HTML-Datei ein …');
        try {
            download(await f.build(options), `${baseName()}.${f.ext}`, f.type);
            if (options.audioFile) S.ui.setStatus('HTML-Datei mit Audio erstellt.', 'success');
        } catch (err) {
            S.ui.showError('Export fehlgeschlagen', err);
        }
    }

    S.format = { clock, cueTime };
    S.export = { toText, toMarkdown, toHtml, toSrt, toVtt, toJson, exportAs, download, baseName };
})(window.Scribe);

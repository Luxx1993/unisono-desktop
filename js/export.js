/*
 * Exporters. Everything is built from the current (edited) segments in Unisono.state,
 * so corrected text and speaker names end up in every format.
 *
 *   txt   plain text:        [Herr Müller - 00:01:12]: Text
 *   md    Markdown with YAML frontmatter (Obsidian, Notion, wikis), optional summary
 *   html  standalone page: readable/printable, optional embedded audio with click-to-jump
 *   srt / vtt  subtitles (vtt with speaker voice tags)
 *   json  project file – can be opened again in Unisono to continue editing
 */
window.Unisono = window.Unisono || {};
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
            format: 'unisono',
            version: 1,
            fileName, provider, createdAt,
            speakers,
            segments: segments.map(({ speaker, start, end, text }) => ({ speaker, start, end, text })),
            summary: S.summary.getText(),
            raw
        }, null, 2);
    }

    // --- Standalone HTML ---
    // The exported page must work on its own, without tokens.css, so the Unisono values are
    // copied here (light and dark). Keep them in sync with css/tokens.css.
    const HTML_STYLE = `
  :root {
    color-scheme: light dark;
    --surface-canvas:#F4F1EC; --surface-raised:#FFFFFF; --surface-sunken:#ECE7E0;
    --text-primary:#1F1C1A; --text-secondary:#5E5852; --text-tertiary:#6F6962;
    --border-subtle:rgba(31,28,26,.08); --border-strong:rgba(31,28,26,.16);
    --mark-playing-bg:rgba(31,28,26,.08); --speaker-label-bg:#ECE7E0;
    --speaker-1:#1F1C1A; --speaker-2:#6F6962; --speaker-3:#A59E96; --speaker-4:#CFC8BF;
    --speaker-on-1:#F4F1EC; --speaker-on-2:#F4F1EC; --speaker-on-3:#1F1C1A; --speaker-on-4:#1F1C1A;
    --elev-1:inset 0 0 0 .5px rgba(31,28,26,.08), 0 1px 2px rgba(31,28,26,.04);
    --font-display:"Manrope",system-ui,sans-serif; --font-body:"Inter",system-ui,sans-serif;
    --font-mono:"IBM Plex Mono",ui-monospace,"SFMono-Regular",monospace;
    --type-display-m:300 40px/46px var(--font-display); --type-body-l:400 18px/28px var(--font-body);
    --type-body:400 15px/24px var(--font-body); --type-small:400 13px/20px var(--font-body);
    --type-label:700 12px/16px var(--font-display); --type-mono:400 13px/20px var(--font-mono);
    --type-name:500 12px/16px var(--font-body); --type-badge:400 10px/12px var(--font-mono);
    --radius-xs:4px; --radius-sm:6px; --radius-lg:16px; --measure:68ch;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface-canvas:#121110; --surface-raised:#1B1A18; --surface-sunken:#0C0B0A;
      --text-primary:#F2EEE8; --text-secondary:#A9A29A; --text-tertiary:#857E77;
      --border-subtle:rgba(242,238,232,.08); --border-strong:rgba(242,238,232,.16);
      --mark-playing-bg:rgba(242,238,232,.10); --speaker-label-bg:#0C0B0A;
      --speaker-1:#F2EEE8; --speaker-2:#A9A29A; --speaker-3:#6B655F; --speaker-4:#45413D;
      --speaker-on-1:#121110; --speaker-on-2:#121110; --speaker-on-3:#F2EEE8; --speaker-on-4:#F2EEE8;
      --elev-1:inset 0 0 0 .5px rgba(242,238,232,.08);
    }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--surface-canvas); color:var(--text-primary); font:var(--type-body); letter-spacing:.01em; -webkit-font-smoothing:antialiased; }
  main { max-width:calc(var(--measure) + 12rem); margin:0 auto; padding:3rem 1.5rem 4rem; }
  .eyebrow { font:var(--type-label); letter-spacing:.08em; text-transform:uppercase; color:var(--text-secondary); margin:0 0 .5rem; }
  h1 { font:var(--type-display-m); letter-spacing:-.015em; margin:0 0 1rem; text-wrap:balance; }
  h2 { font:var(--type-label); letter-spacing:.08em; text-transform:uppercase; color:var(--text-secondary); margin:2.5rem 0 1rem; }
  dl { display:flex; flex-wrap:wrap; gap:.25rem 1.5rem; margin:0; font:var(--type-mono); color:var(--text-secondary); }
  dt { display:none; } dd { margin:0; }
  .player { position:sticky; top:0; z-index:1; background:var(--surface-canvas); padding:1rem 0; margin-top:1.5rem; border-bottom:1px solid var(--border-subtle); }
  audio { width:100%; }
  .summary { background:var(--surface-raised); box-shadow:var(--elev-1); border-radius:var(--radius-lg); padding:1.5rem; white-space:pre-wrap; font:var(--type-body); max-width:var(--measure); }
  .transcript { background:var(--surface-raised); box-shadow:var(--elev-1); border-radius:var(--radius-lg); padding:1rem 1.5rem; }
  .seg { display:grid; grid-template-columns:4.5rem minmax(0,1fr); column-gap:1rem; padding:1rem .5rem; border-radius:10px; break-inside:avoid; }
  .time { grid-row:1 / span 2; font:var(--type-mono); color:var(--text-tertiary); background:none; border:0; padding:.25rem 0 0; text-align:left; font-variant-numeric:tabular-nums; }
  button.time { cursor:pointer; }
  button.time:hover, button.time:focus-visible { color:var(--text-primary); text-decoration:underline; }
  .who { grid-column:2; justify-self:start; display:inline-flex; align-items:center; gap:.5rem; padding:.25rem .5rem .25rem .25rem; border-radius:var(--radius-sm); background:var(--speaker-label-bg); font:var(--type-name); }
  .abbr { display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:var(--radius-xs); background:var(--spk); color:var(--spk-on); font:var(--type-badge); }
  .spk-1 { --spk:var(--speaker-1); --spk-on:var(--speaker-on-1); } .spk-2 { --spk:var(--speaker-2); --spk-on:var(--speaker-on-2); }
  .spk-3 { --spk:var(--speaker-3); --spk-on:var(--speaker-on-3); } .spk-4 { --spk:var(--speaker-4); --spk-on:var(--speaker-on-4); }
  .seg p { grid-column:2; margin:.5rem 0 0; font:var(--type-body-l); max-width:var(--measure); }
  .seg.active { background:var(--mark-playing-bg); box-shadow:inset 2px 0 0 var(--text-primary); }
  footer { margin-top:2rem; font:var(--type-small); color:var(--text-tertiary); }
  @media (max-width:640px) {
    h1 { font:400 28px/34px var(--font-display); }
    .seg { grid-template-columns:minmax(0,1fr); }
    .time { grid-row:1; justify-self:end; }
    .who, .seg p { grid-column:1; } .who { grid-row:1; }
    .seg p { font:var(--type-body); }
  }
  @media print {
    :root { color-scheme:light; }
    body { background:#fff; }
    main { padding:0; max-width:none; }
    .player { display:none; }
    .transcript, .summary { box-shadow:none; padding:0; }
    .seg { padding:.4rem 0; }
  }`;

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

    const AUDIO_PLACEHOLDER = '__UNISONO_AUDIO_SRC__';

    // Returns a string, or a Blob when audio is embedded (assembled from chunks, see above).
    async function toHtml({ includeSummary = true, audioFile = null } = {}) {
        const m = meta();
        const withTimes = S.state.hasTimes();
        const summary = includeSummary ? S.summary.getText().trim() : '';
        const audioSrc = audioFile ? await readAsDataUrl(audioFile) : null;

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
            const who = name
                ? `<span class="who"><span class="abbr spk-${S.editor.tierOf(seg.speaker) || 1}" aria-hidden="true">${escapeHtml(S.editor.abbreviation(seg.speaker))}</span>${escapeHtml(name)}</span>`
                : '';
            return `<article class="seg" data-start="${seg.start}" data-end="${seg.end}">
    ${time}${who}
    <p>${escapeHtml(seg.text.trim())}</p>
  </article>`;
        }).join('\n  ');

        const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(m.title)}</title>
<style>${HTML_STYLE}
</style>
</head>
<body>
<main>
  <p class="eyebrow">Transkript${m.provider ? ' · ' + escapeHtml(m.provider) : ''}</p>
  <h1>${escapeHtml(m.title)}</h1>
  <dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
  ${audioSrc ? `<div class="player"><audio id="audio" controls preload="metadata" src="${AUDIO_PLACEHOLDER}"></audio></div>` : ''}
  ${summary ? `<h2>Zusammenfassung</h2>\n  <div class="summary">${escapeHtml(summary)}</div>` : ''}
  <h2>Transkript</h2>
  <div class="transcript">
  ${segmentsHtml}
  </div>
  <footer>Erstellt mit Unisono · ${escapeHtml(m.dateText)}</footer>
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
        json: { build: toJson, ext: 'unisono.json', type: 'application/json' }
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
})(window.Unisono);

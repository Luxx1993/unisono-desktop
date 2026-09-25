/*
 * Exporters. Everything is built from the current (edited) segments in Scribe.state,
 * so corrected text and speaker names end up in every format.
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

    function timedSegments() {
        return S.state.get().segments.filter(s => s.end > 0 && s.text.trim());
    }

    // [Herr Müller - 00:01:12]: Hallo, wie geht es dir?
    function toText() {
        const withTimes = S.state.hasTimes();
        return S.state.get().segments
            .filter(s => s.text.trim())
            .map(seg => {
                const parts = [speakerLabel(seg), withTimes ? clock(seg.start) : ''].filter(Boolean);
                return parts.length ? `[${parts.join(' - ')}]: ${seg.text.trim()}` : seg.text.trim();
            })
            .join('\n\n');
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

    function toJson() {
        const { fileName, provider, speakers, segments, raw } = S.state.get();
        return JSON.stringify({ fileName, provider, speakers, segments, raw }, null, 2);
    }

    function baseName() {
        const name = S.state.get().fileName;
        return name ? name.replace(/\.[^.]+$/, '') : 'transkription';
    }

    function download(content, filename, type) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const FORMATS = {
        txt: { build: toText, type: 'text/plain;charset=utf-8', timed: false },
        srt: { build: toSrt, type: 'application/x-subrip;charset=utf-8', timed: true },
        vtt: { build: toVtt, type: 'text/vtt;charset=utf-8', timed: true },
        json: { build: toJson, type: 'application/json', timed: false }
    };

    function exportAs(format) {
        if (!S.state.get().segments.length) return S.ui.setStatus('Noch kein Transkript vorhanden.', 'error');
        const f = FORMATS[format];
        if (f.timed && !timedSegments().length) {
            return S.ui.setStatus(`Keine Zeitstempel vorhanden – ${format.toUpperCase()}-Export nicht möglich.`, 'error');
        }
        download(f.build(), `${baseName()}.${format}`, f.type);
    }

    S.format = { clock, cueTime };
    S.export = { toText, toSrt, toVtt, toJson, exportAs, download, baseName };
})(window.Scribe);

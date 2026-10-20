/*
 * Player: own controls (play, ±10 s, speed) and a timeline that shows who spoke when.
 *
 * The timeline is a canvas with two parts: the waveform on top, in one color (played part
 * --wave-played, the rest --wave-rest), and below it the speaker lane: one bar per segment in
 * the speaker's grey tier (--speaker-1 … 4) on --speaker-lane. The playhead runs through both.
 * Without audio data (e.g. a restored transcript) only a flat line and the lane are drawn.
 * Click or drag to seek, arrow keys move by 5 s; hovering shows time and speaker.
 *
 * Waveform without filling the memory: browsers decode a whole file at full sample rate
 * (a 2-hour meeting would need several GB). So:
 *   WAV  – samples are read block by block, nothing is decoded;
 *   MP3  – decoded in slices of CHUNK_BYTES (MP3 frames stand on their own);
 *   other formats (M4A, WebM, OGG) – decoded at once, only up to FULL_DECODE_MAX_SECONDS.
 * Longer files keep the speaker timeline, which needs no audio data at all.
 */
window.Unisono = window.Unisono || {};

(function (S) {
    const $ = id => document.getElementById(id);
    const FULL_DECODE_MAX_SECONDS = 20 * 60;
    const FULL_DECODE_MAX_BYTES = 60 * 1024 * 1024;
    const CHUNK_BYTES = 2 * 1024 * 1024;
    const DECODE_RATE = 3000;   // lowest rate browsers accept; plenty for an overview
    const PEAK_BUCKETS = 4000;
    const BAR_WIDTH = 3;   // CSS px incl. gap
    const SEEK_STEP = 5;

    let audio, canvas, wrap, hoverEl;
    let peaks = null;          // Float32Array(PEAK_BUCKETS), 0…1
    let peaksFor = null;       // the File the peaks belong to
    let file = null;
    let frame = null;
    let dragging = false;

    // --- Time & colors ---
    function duration() {
        const segEnd = S.state.get().segments.reduce((max, s) => Math.max(max, s.end || 0), 0);
        const d = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
        return Math.max(d, segEnd);
    }

    function hasAudio() {
        return !!audio?.currentSrc && !audio.error;
    }

    // Colors come from tokens.css, read once per draw (they change with light / dark).
    function tokens() {
        const style = getComputedStyle(document.documentElement);
        const get = name => style.getPropertyValue(name).trim();
        const px = name => parseFloat(get(name)) || 0;
        return {
            played: get('--wave-played'),
            rest: get('--wave-rest'),
            lane: get('--speaker-lane'),
            none: get('--border-strong'),
            head: get('--text-primary'),
            mark: get('--text-tertiary'),
            gapMark: get('--status-warning'),
            speakers: [1, 2, 3, 4].map(n => get('--speaker-' + n)),
            waveHeight: px('--wave-height'),
            gap: px('--space-2'),
            laneHeight: px('--speaker-lane-height'),
            barHeight: px('--speaker-bar-height'),
            radius: px('--radius-xs')
        };
    }

    // Speaker tier color per speaker id, resolved once per draw.
    function speakerColors(t) {
        const colors = {};
        for (const spk of S.state.get().speakers) {
            colors[spk.id] = t.speakers[(S.editor.tierOf(spk.id) || 1) - 1];
        }
        return colors;
    }

    // Segments sorted by start, for a single sweep while drawing.
    function sortedSegments() {
        return S.state.get().segments.filter(s => s.end > s.start).slice().sort((a, b) => a.start - b.start);
    }

    // --- Drawing ---
    function scheduleDraw() {
        if (frame) return;
        frame = requestAnimationFrame(() => { frame = null; draw(); });
    }

    function draw() {
        if (!canvas || wrap.classList.contains('hidden')) return;
        const dpr = window.devicePixelRatio || 1;
        const width = wrap.clientWidth;
        const height = wrap.clientHeight;
        if (!width || !height) return;
        if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const total = duration();
        if (!total) return;
        const t = tokens();
        const now = hasAudio() ? audio.currentTime : 0;
        const colors = speakerColors(t);
        const segs = sortedSegments();
        const waveH = Math.min(t.waveHeight, height - t.gap - t.laneHeight);
        const mid = waveH / 2;
        const laneTop = waveH + t.gap;

        // Waveform: one color, played part darker.
        if (peaks && peaksFor === file) {
            const bars = Math.floor(width / BAR_WIDTH);
            for (let i = 0; i < bars; i++) {
                const t0 = (i / bars) * total;
                const t1 = ((i + 1) / bars) * total;
                const from = Math.floor((t0 / total) * PEAK_BUCKETS);
                const to = Math.max(from + 1, Math.floor((t1 / total) * PEAK_BUCKETS));
                let p = 0;
                for (let j = from; j < to && j < PEAK_BUCKETS; j++) p = Math.max(p, peaks[j]);
                const h = Math.max(2, p * (waveH - 4));
                ctx.fillStyle = (t0 + t1) / 2 <= now ? t.played : t.rest;
                ctx.fillRect(i * BAR_WIDTH, mid - h / 2, BAR_WIDTH - 1, h);
            }
        } else {
            ctx.fillStyle = t.rest;
            ctx.fillRect(0, mid - 1, width, 2);
            if (now > 0) {
                ctx.fillStyle = t.played;
                ctx.fillRect(0, mid - 1, (now / total) * width, 2);
            }
        }

        // Speaker lane: background, then one bar per segment in the speaker's tier.
        ctx.fillStyle = t.lane;
        roundRect(ctx, 0, laneTop, width, t.laneHeight, t.radius);
        const barTop = laneTop + (t.laneHeight - t.barHeight) / 2;
        for (const seg of segs) {
            const x = (seg.start / total) * width;
            const w = Math.max(1, ((seg.end - seg.start) / total) * width - 1);
            ctx.fillStyle = (seg.speaker && colors[seg.speaker]) || t.none;
            ctx.fillRect(x, barTop, w, t.barHeight);
        }

        // Markers: a thin line through the waveform with a small flag on top.
        for (const m of S.state.get().markers) {
            const x = Math.round((m.time / total) * width);
            ctx.fillStyle = m.kind === 'gap' ? t.gapMark : t.mark;
            ctx.fillRect(x, 0, 1, waveH);
            ctx.fillRect(x, 0, 6, 4);
        }

        // Playhead through waveform and lane.
        if (hasAudio() && now > 0) {
            const x = Math.round((now / total) * width);
            ctx.fillStyle = t.head;
            ctx.fillRect(x - 1, 0, 2, laneTop + t.laneHeight);
        }

        wrap.setAttribute('aria-valuemax', String(Math.round(total)));
        wrap.setAttribute('aria-valuenow', String(Math.round(now)));
        wrap.setAttribute('aria-valuetext', `${S.format.clock(now)} von ${S.format.clock(total)}`);
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
        else ctx.rect(x, y, w, h);
        ctx.fill();
    }

    // --- Seeking & hover ---
    function timeAt(clientX) {
        const rect = wrap.getBoundingClientRect();
        const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        return f * duration();
    }

    function seek(seconds) {
        const t = Math.max(0, Math.min(duration(), seconds));
        if (hasAudio()) {
            audio.currentTime = t;
        } else {
            // Without audio, jump to the segment in the text instead.
            const seg = S.state.segmentAt(t) || sortedSegments().find(s => s.start >= t);
            if (seg) S.editor.reveal(seg.id);
        }
        updateControls();
        scheduleDraw();
    }

    function showHover(clientX) {
        const t = timeAt(clientX);
        const seg = S.state.segmentAt(t);
        const rect = wrap.getBoundingClientRect();
        // Within a few pixels of a marker, show the marker instead.
        const near = (5 / rect.width) * duration();
        const marker = S.state.get().markers.find(m => Math.abs(m.time - t) <= near);
        hoverEl.textContent = marker
            ? `${S.format.clock(marker.time)} · ${marker.label}`
            : S.format.clock(t) + (seg?.speaker ? ` · ${S.editor.abbreviation(seg.speaker)} ${S.state.speakerName(seg.speaker)}` : '');
        const x = Math.min(rect.width - 8, Math.max(8, clientX - rect.left));
        hoverEl.style.left = x + 'px';
        hoverEl.classList.remove('hidden');
    }

    function onPointerDown(e) {
        if (!duration()) return;
        dragging = true;
        wrap.setPointerCapture(e.pointerId);
        seek(timeAt(e.clientX));
    }

    function onPointerMove(e) {
        showHover(e.clientX);
        if (dragging && hasAudio()) seek(timeAt(e.clientX));
    }

    function onKey(e) {
        const now = hasAudio() ? audio.currentTime : 0;
        const moves = { ArrowLeft: now - SEEK_STEP, ArrowRight: now + SEEK_STEP, Home: 0, End: duration() };
        if (!(e.key in moves)) return;
        e.preventDefault();
        seek(moves[e.key]);
    }

    // --- Waveform peaks ---
    // Reduces a stream of sample blocks (in time order) to PEAK_BUCKETS maxima.
    function peakReducer(totalSamples) {
        const out = new Float32Array(PEAK_BUCKETS);
        let pos = 0;
        return {
            add(samples, stride = 1) {
                for (let j = 0; j < samples.length; j += stride) {
                    const bucket = Math.min(PEAK_BUCKETS - 1, Math.floor((pos / totalSamples) * PEAK_BUCKETS));
                    const v = Math.abs(samples[j]);
                    if (v > out[bucket]) out[bucket] = v;
                    pos += stride;
                }
            },
            skip(count) { pos += count; },
            result() {
                let max = 0;
                for (const v of out) if (v > max) max = v;
                // Normalise and lift quiet passages a little so speech stays visible.
                if (max > 0) for (let i = 0; i < PEAK_BUCKETS; i++) out[i] = Math.pow(out[i] / max, 0.7);
                return out;
            }
        };
    }

    function offlineContext() {
        const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        return Offline ? new Offline(1, 1, DECODE_RATE) : null;
    }

    // PCM WAV: parse the header, then read the first channel block by block.
    async function wavPeaks(f) {
        const head = new DataView(await f.slice(0, 64 * 1024).arrayBuffer());
        if (head.getUint32(0, false) !== 0x52494646 || head.getUint32(8, false) !== 0x57415645) return null;
        let offset = 12, format = null, dataStart = null, dataSize = 0;
        while (offset + 8 <= head.byteLength) {
            const id = head.getUint32(offset, false);
            const size = head.getUint32(offset + 4, true);
            if (id === 0x666d7420) {   // 'fmt '
                format = {
                    code: head.getUint16(offset + 8, true),
                    channels: head.getUint16(offset + 10, true),
                    bits: head.getUint16(offset + 22, true)
                };
            } else if (id === 0x64617461) {   // 'data'
                dataStart = offset + 8;
                dataSize = Math.min(size, f.size - dataStart);
                break;
            }
            offset += 8 + size + (size % 2);
        }
        if (!format || dataStart == null || ![1, 3].includes(format.code) || ![8, 16, 24, 32].includes(format.bits)) return null;
        const bytesPerFrame = format.channels * format.bits / 8;
        const frames = Math.floor(dataSize / bytesPerFrame);
        // Read at most ~4 M frames: enough for the overview, cheap for long files.
        const stride = Math.max(1, Math.floor(frames / 4e6));
        const reducer = peakReducer(frames);
        const block = bytesPerFrame * 256 * 1024;
        for (let at = 0; at < frames * bytesPerFrame; at += block) {
            const view = new DataView(await f.slice(dataStart + at, dataStart + Math.min(at + block, frames * bytesPerFrame)).arrayBuffer());
            const n = Math.floor(view.byteLength / bytesPerFrame);
            const samples = new Float32Array(Math.ceil(n / stride));
            for (let i = 0, k = 0; i < n; i += stride, k++) {
                const o = i * bytesPerFrame;
                samples[k] = format.bits === 16 ? view.getInt16(o, true) / 32768
                    : format.bits === 8 ? (view.getUint8(o) - 128) / 128
                    : format.bits === 24 ? ((view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16)) / 8388608)
                    : format.code === 3 ? view.getFloat32(o, true) : view.getInt32(o, true) / 2147483648;
            }
            reducer.add(samples);
            if (stride > 1) reducer.skip(n - samples.length);
        }
        return reducer.result();
    }

    async function decode(buffer) {
        const ctx = offlineContext();
        if (!ctx) return null;
        return (await ctx.decodeAudioData(buffer)).getChannelData(0);
    }

    // MP3: decode slice by slice; a slice that fails counts as silence of its estimated length.
    async function mp3Peaks(f, seconds) {
        const parts = [];
        let decoded = 0;
        for (let at = 0; at < f.size; at += CHUNK_BYTES) {
            if (f !== file) return null;
            const size = Math.min(CHUNK_BYTES, f.size - at);
            try {
                const samples = await decode(await f.slice(at, at + size).arrayBuffer());
                parts.push(samples);
                decoded += samples.length;
            } catch (_) {
                const estimate = Math.round((size / f.size) * (seconds || 0) * DECODE_RATE);
                parts.push(estimate);
                decoded += estimate;
            }
        }
        const reducer = peakReducer(decoded || 1);
        for (const part of parts) typeof part === 'number' ? reducer.skip(part) : reducer.add(part);
        return reducer.result();
    }

    async function computePeaks(f, seconds) {
        const name = f.name.toLowerCase();
        if (f.type.includes('wav') || name.endsWith('.wav')) {
            const result = await wavPeaks(f);
            if (result) return result;
        }
        if (f.type === 'audio/mpeg' || name.endsWith('.mp3')) return mp3Peaks(f, seconds);
        if (f.size > FULL_DECODE_MAX_BYTES || (seconds && seconds > FULL_DECODE_MAX_SECONDS)) return null;
        const samples = await decode(await f.arrayBuffer());
        if (!samples) return null;
        const reducer = peakReducer(samples.length);
        reducer.add(samples);
        return reducer.result();
    }

    function setNote(text) {
        $('player-note').textContent = text || '';
        $('player-note').classList.toggle('hidden', !text);
    }

    async function loadWaveform() {
        const target = file;
        peaks = null;
        peaksFor = null;
        setNote('');
        if (!target) return scheduleDraw();
        const seconds = Number.isFinite(audio.duration) ? audio.duration : null;
        setNote('Wellenform wird berechnet …');
        try {
            const result = await computePeaks(target, seconds);
            if (target !== file) return;
            peaks = result;
            peaksFor = result ? target : null;
            setNote(result ? '' : 'Für diese Datei keine Wellenform (bei M4A, WebM und OGG nur bis 20 min). Die Sprecherspur zeigt, wer wann spricht.');
        } catch (_) {
            if (target === file) setNote('');
        }
        scheduleDraw();
    }

    // --- Controls ---
    function updateControls() {
        const ready = hasAudio();
        ['player-play', 'player-back', 'player-fwd', 'player-rate'].forEach(id => { $(id).disabled = !ready; });
        const playing = ready && !audio.paused;
        S.setIcon($('player-play').firstElementChild, playing ? 'pause' : 'play');
        $('player-play').title = playing ? 'Pause' : 'Abspielen';
        $('player-play').setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
        const total = duration();
        $('player-time').textContent = `${S.format.clock(ready ? audio.currentTime : 0)} / ${S.format.clock(total)}`;
    }

    // Called by app.js when a file is chosen (or cleared).
    function setFile(newFile) {
        file = newFile;
        peaks = null;
        peaksFor = null;
        setNote('');
        updateControls();
        scheduleDraw();
        // The duration decides whether to decode; wait for the metadata.
        if (file) {
            if (Number.isFinite(audio.duration) && audio.readyState >= 1) loadWaveform();
            else audio.addEventListener('loadedmetadata', function once() {
                audio.removeEventListener('loadedmetadata', once);
                if (file === newFile) loadWaveform();
            });
        }
    }

    function init() {
        audio = $('audio-player');
        canvas = $('timeline-canvas');
        wrap = $('timeline');
        hoverEl = $('timeline-hover');

        $('player-play').addEventListener('click', () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
        $('player-back').addEventListener('click', () => seek(audio.currentTime - 10));
        $('player-fwd').addEventListener('click', () => seek(audio.currentTime + 10));
        $('player-rate').addEventListener('change', e => { audio.playbackRate = Number(e.target.value); });
        ['play', 'pause', 'durationchange', 'loadedmetadata', 'emptied', 'error'].forEach(type => audio.addEventListener(type, () => { updateControls(); scheduleDraw(); }));
        audio.addEventListener('timeupdate', () => { updateControls(); scheduleDraw(); });
        audio.addEventListener('ratechange', () => { $('player-rate').value = String(audio.playbackRate); });
        // Talk-time percentages use the real length of the recording once it is known.
        audio.addEventListener('durationchange', () => S.editor?.refreshSpeakers());

        wrap.addEventListener('pointerdown', onPointerDown);
        wrap.addEventListener('pointermove', onPointerMove);
        wrap.addEventListener('pointerup', () => { dragging = false; });
        wrap.addEventListener('pointerleave', () => { if (!dragging) hoverEl.classList.add('hidden'); });
        wrap.addEventListener('keydown', onKey);

        if (window.ResizeObserver) new ResizeObserver(scheduleDraw).observe(wrap);
        S.state.subscribe(type => { if (!['text', 'tasks', 'project'].includes(type)) { updateControls(); scheduleDraw(); } });
        S.appearance.onChange(scheduleDraw);
        updateControls();
    }

    S.player = { init, setFile, redraw: scheduleDraw, duration, hasWaveform: () => !!peaks && peaksFor === file };
})(window.Unisono);

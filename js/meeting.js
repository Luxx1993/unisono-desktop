/*
 * Meeting recording without a bot (optional module, loaded on first use from app.js).
 *
 * Records the sound of a web meeting – a browser tab, or on Windows the whole screen with system
 * sound for a desktop app – together with the own microphone, mixed into one file. The file then
 * goes the usual way (Transkribieren). While recording, the level of both sources is sampled every
 * 0.2 s; after a transcription with speaker separation, the speaker who mostly talks while the own
 * microphone is louder than the meeting is named "Ich" (see protocolCore.selfSpeaker, app.js).
 *
 * Before the start, the user has to confirm that everybody in the meeting knows and agrees:
 * recording the privately spoken word secretly is a crime in Germany (§ 201 StGB).
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    const BITRATE = 64000;
    const STEP = 0.2;             // seconds between two level samples
    const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

    let host = null;
    let ui = null;
    let source = 'tab';           // 'tab' | 'screen'
    let withMic = true;
    let rec = null;               // the running recording
    let last = null;              // the finished file

    function el(tag, props = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v == null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else if (k in node && k !== 'list') node[k] = v;
            else node.setAttribute(k, v);
        }
        node.append(...children.filter(c => c != null && c !== false));
        return node;
    }

    const supported = () => !!(navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder && (window.AudioContext || window.webkitAudioContext));
    const pickMime = () => MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
    const pad = n => String(n).padStart(2, '0');

    function fileName(mime, d = new Date()) {
        const ext = /mp4/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
        return `Meeting ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}.${ext}`;
    }

    // --- UI -------------------------------------------------------------------------------------------
    function open(container) {
        host = container;
        render();
        host.closest('.card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function render() {
        if (!host) return;
        if (!supported()) {
            host.replaceChildren(el('p', { class: 't-small', text: 'Dieser Browser kann den Ton anderer Tabs oder des Bildschirms nicht aufnehmen. Das geht in Chrome und Edge am Computer.' }));
            return;
        }
        if (rec) return renderRecording();
        host.classList.remove('recorder', 'is-recording', 'meeting-recording');

        const consent = el('input', { type: 'checkbox', id: 'meeting-consent' });
        const start = el('button', { type: 'button', class: 'btn-primary', disabled: true, onclick: () => start_(consent.checked) },
            S.icon('mic'), 'Aufnahme starten');
        consent.addEventListener('change', () => { start.disabled = !consent.checked; });

        const sources = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Quelle' },
            ...[['tab', 'Browser-Tab'], ['screen', 'Bildschirm mit Systemton']].map(([id, label]) =>
                el('button', { type: 'button', role: 'radio', 'aria-checked': String(source === id), text: label, onclick: () => { source = id; render(); } })));
        const mic = el('input', { type: 'checkbox', checked: withMic });
        mic.addEventListener('change', () => { withMic = mic.checked; });

        host.replaceChildren(
            el('p', { class: 't-small muted', text: source === 'tab'
                ? 'Im nächsten Schritt den Tab mit dem Meeting wählen (Teams, Zoom, Meet im Browser) und „Tab-Audio teilen“ eingeschaltet lassen.'
                : 'Für die Desktop-App eines Meetings: „Gesamter Bildschirm“ wählen und „Systemaudio teilen“ einschalten. Das gibt es in Chrome und Edge unter Windows; am Mac nimmt der Browser keinen Systemton auf.' }),
            sources,
            el('label', { class: 'check' }, mic, ' Eigenes Mikrofon mit aufnehmen (wird nach dem Transkribieren als „Ich“ erkannt)'),
            el('div', { class: 'notice meeting-consent' },
                el('label', { class: 'check' }, consent, ' Alle Teilnehmer wissen, dass aufgenommen wird, und sind einverstanden.'),
                el('p', { class: 't-small muted', text: 'Das nichtöffentlich gesprochene Wort heimlich aufzunehmen ist strafbar (§ 201 StGB). Sag zu Beginn, dass du aufnimmst und wofür.' })),
            el('div', { class: 'button-row' }, start),
            last ? lastFileRow() : null);
    }

    function lastFileRow() {
        return el('div', { class: 'meeting-last' },
            el('p', { class: 't-small', text: `Letzte Meeting-Aufnahme: ${last.name} (${S.format.clock(last.seconds)})` }),
            el('div', { class: 'button-row' },
                el('button', { type: 'button', class: 'btn-secondary is-small', text: 'Zum Transkribieren', onclick: () => handOver(last.file, last.seconds) }),
                el('button', { type: 'button', class: 'btn-text', text: 'Aufnahme speichern', onclick: () => S.export.download(last.file, last.name, last.file.type) })));
    }

    function renderRecording() {
        host.classList.add('recorder', 'is-recording', 'meeting-recording');
        ui = {
            time: el('p', { class: 'rec-display-time', text: '00:00:00' }),
            meeting: el('div', { class: 'rec-level-bar' }),
            mic: el('div', { class: 'rec-level-bar' })
        };
        host.replaceChildren(
            el('p', { class: 'rec-display-status' }, el('span', { class: 'status-dot rec-dot', 'aria-hidden': 'true' }), el('span', { class: 't-label', text: 'Meeting wird aufgenommen' })),
            ui.time,
            el('div', { class: 'meeting-levels' },
                el('span', { class: 't-small muted', text: 'Meeting' }), el('div', { class: 'rec-level' }, ui.meeting),
                rec.micSource ? el('span', { class: 't-small muted', text: 'Mikrofon' }) : null,
                rec.micSource ? el('div', { class: 'rec-level' }, ui.mic) : null),
            el('p', { class: 't-small muted', text: 'Diesen Tab offen lassen. Beenden auch über „Freigabe beenden“ in der Leiste des Browsers.' }),
            el('div', { class: 'button-row' }, el('button', { type: 'button', class: 'btn-primary', onclick: stop }, S.icon('stop'), 'Aufnahme beenden')));
    }

    // --- Recording ----------------------------------------------------------------------------------------
    async function start_(consented) {
        if (!consented || rec) return;
        if (S.recorder.isActive() || S.dictation.isActive?.()) return S.ui.setStatus('Bitte zuerst die laufende Aufnahme beenden.', 'error');
        let display = null;
        let mic = null;
        try {
            display = await navigator.mediaDevices.getDisplayMedia({
                video: source === 'screen' ? { displaySurface: 'monitor' } : { displaySurface: 'browser' },
                // Meeting audio as it is: no echo cancellation or noise suppression on someone else's voice.
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
                systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include', preferCurrentTab: false
            });
            const audio = display.getAudioTracks()[0];
            if (!audio) {
                throw new Error(source === 'tab'
                    ? 'Es kam kein Ton an. Beim Teilen einen Tab wählen und „Tab-Audio teilen“ eingeschaltet lassen.'
                    : 'Es kam kein Ton an. „Gesamter Bildschirm“ wählen und „Systemaudio teilen“ einschalten (nur unter Windows).');
            }
            if (withMic) {
                try { mic = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS); }
                catch (_) { S.ui.setStatus('Kein Zugriff auf das Mikrofon. Es wird nur der Meeting-Ton aufgenommen.', 'note'); }
            }
            rec = begin(display, mic);
        } catch (err) {
            display?.getTracks().forEach(t => t.stop());
            mic?.getTracks().forEach(t => t.stop());
            if (err.name === 'NotAllowedError') S.ui.setStatus('Teilen abgebrochen. Ohne Freigabe kann der Meeting-Ton nicht aufgenommen werden.', 'note');
            else S.ui.showError('Meeting-Aufnahme nicht möglich', err);
            return;
        }
        render();
        S.ui.setStatus('Meeting-Aufnahme läuft.', 'info');
    }

    function begin(display, mic) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const destination = ctx.createMediaStreamDestination();
        const analyser = () => { const a = ctx.createAnalyser(); a.fftSize = 1024; return a; };

        const meetingSource = ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks()));
        const meetingLevel = analyser();
        meetingSource.connect(meetingLevel);
        meetingSource.connect(destination);

        let micSource = null;
        const micLevel = analyser();
        if (mic) {
            micSource = ctx.createMediaStreamSource(mic);
            micSource.connect(micLevel);
            micSource.connect(destination);
        }

        const mime = pickMime();
        const recorder = new MediaRecorder(destination.stream, mime ? { mimeType: mime, audioBitsPerSecond: BITRATE } : { audioBitsPerSecond: BITRATE });
        const r = {
            ctx, display, mic, micSource, recorder, chunks: [], mime: recorder.mimeType || mime || 'audio/webm',
            startedAt: performance.now(), timeline: { step: STEP, mic: [], tab: [] }, timer: null,
            levels: { meeting: meetingLevel, mic: micSource ? micLevel : null }, buffer: new Float32Array(1024)
        };
        recorder.ondataavailable = e => { if (e.data.size) r.chunks.push(e.data); };
        recorder.start(1000);
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        r.timer = setInterval(() => sample(r), STEP * 1000);
        // "Freigabe beenden" in the browser ends the recording.
        display.getTracks().forEach(t => t.addEventListener('ended', () => { if (rec === r) stop(); }));
        window.addEventListener('beforeunload', warnOnLeave);
        return r;
    }

    function rms(analyser, buffer) {
        if (!analyser) return 0;
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        return Math.sqrt(sum / buffer.length);
    }

    function sample(r) {
        const meeting = rms(r.levels.meeting, r.buffer);
        const mic = rms(r.levels.mic, r.buffer);
        r.timeline.tab.push(Math.round(meeting * 1000) / 1000);
        r.timeline.mic.push(Math.round(mic * 1000) / 1000);
        if (!ui) return;
        ui.time.textContent = S.format.clock((performance.now() - r.startedAt) / 1000);
        ui.meeting.style.transform = `scaleX(${Math.min(1, meeting * 4).toFixed(3)})`;
        ui.mic.style.transform = `scaleX(${Math.min(1, mic * 4).toFixed(3)})`;
    }

    const warnOnLeave = e => { e.preventDefault(); e.returnValue = ''; };

    async function stop() {
        const r = rec;
        if (!r) return;
        rec = null;
        clearInterval(r.timer);
        window.removeEventListener('beforeunload', warnOnLeave);
        const seconds = (performance.now() - r.startedAt) / 1000;
        await new Promise(resolve => {
            if (r.recorder.state === 'inactive') return resolve();
            r.recorder.onstop = resolve;
            r.recorder.stop();
        });
        r.display.getTracks().forEach(t => t.stop());
        r.mic?.getTracks().forEach(t => t.stop());
        r.ctx.close().catch(() => {});
        ui = null;

        const name = fileName(r.mime);
        const file = new File(r.chunks, name, { type: r.mime });
        if (r.micSource) file.unisonoMeeting = r.timeline;
        last = { file, name, seconds };
        render();
        if (file.size < 1000) return S.ui.setStatus('Es wurde kein Ton aufgenommen.', 'error');
        handOver(file, seconds);
    }

    // The recording goes the usual way: the file page, transcribed with speaker separation.
    function handOver(file, seconds) {
        S.app.loadFile(file);
        S.app.switchView('start');
        const diarize = document.getElementById('diarize');
        if (diarize && !diarize.disabled) diarize.checked = true;
        S.ui.setStatus(`Meeting-Aufnahme (${S.format.clock(seconds)}) bereit. Mit einer Engine mit Sprechertrennung transkribieren`
            + (file.unisonoMeeting ? '; dein Mikrofon wird danach als „Ich“ erkannt.' : '.'), 'success');
    }

    S.meeting = { open, isActive: () => !!rec, stop };
})(window.Unisono);

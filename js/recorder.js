/*
 * Microphone recorder for dictations and on-site meetings.
 *
 * Records with MediaRecorder (Opus/WebM where supported, AAC/MP4 on Safari), shows a timer
 * and input level, supports pause/resume, and keeps the screen awake while recording.
 * When stopped, the recording is handed to the app like an uploaded file (onRecorded).
 *
 * While recording, every second of audio is also written to IndexedDB (recording-backup.js),
 * so a recording interrupted by a closed tab or a crash can be restored on the next visit.
 *
 * On site (phone):
 * - The microphone does not feed MediaRecorder directly but goes through an audio graph
 *   (mic → MediaStreamDestination → MediaRecorder). When the phone locks the screen or the
 *   user switches apps, browsers stop or mute the microphone; afterwards a new microphone
 *   stream is connected to the same destination, so the recording continues in the SAME
 *   file. The gap is noted as a marker ("Unterbrechung").
 * - The recorded time follows the audio clock (AudioContext.currentTime), which stands still
 *   while the context is suspended – so markers match the position in the audio file.
 * - Markers ("Merker") can be set while recording; they travel with the file to the
 *   transcript (file.unisonoMarkers).
 * - The recording page is the on-site view: a large marker button, then pause / stop. The
 *   screen can be dimmed to save battery. On the desktop a full-screen view (#rec-focus) is
 *   available as an option.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const $ = id => document.getElementById(id);
    const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    const BITRATE = 64000; // ~0.5 MB per minute, plenty for speech
    const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    const GAP_MIN_SECONDS = 1.5;   // shorter interruptions are not worth a marker

    let onRecorded = () => {};
    let stream = null;            // current microphone stream
    let micSource = null;
    let destination = null;       // MediaStreamDestination the recorder listens to (null: direct mic)
    let recorder = null;
    let chunks = [];
    let markers = [];             // { time, label, kind: 'mark' | 'gap' }
    let recordedBefore = 0;       // seconds recorded before the current stretch
    let stretchStart = 0;         // audio clock (or wall clock / 1000) at the start of the stretch
    let timer = null;
    let audioCtx = null;
    let analyser = null;
    let levelFrame = null;
    let wakeLock = null;
    let lastRecording = null;
    let unsaved = false;          // a finished recording that was neither transcribed nor saved
    let lastBackupUpdate = 0;
    let pendingRecovery = null;   // unfinished recording found in the backup on page load
    let pendingDuration = 0;
    let interruption = null;      // { at: recorded seconds, since: Date.now(), needsMic: bool }
    let mode = 'idle';            // 'idle' | 'recording' | 'paused' | 'interrupted'

    function supported() {
        return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    }

    function pickMimeType() {
        return MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
    }

    function extensionFor(mime) {
        if (mime.includes('mp4')) return 'm4a';
        if (mime.includes('ogg')) return 'ogg';
        return 'webm';
    }

    function fileName(mime, d = new Date()) {
        const pad = n => String(n).padStart(2, '0');
        return `aufnahme-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.${extensionFor(mime)}`;
    }

    // --- Time: follows the audio clock when recording through the graph ---
    function clockNow() {
        return destination ? audioCtx.currentTime : Date.now() / 1000;
    }

    function recordedSeconds() {
        return recordedBefore + (recorder?.state === 'recording' ? Math.max(0, clockNow() - stretchStart) : 0);
    }

    function closeStretch() {
        if (recorder?.state === 'recording') recordedBefore += Math.max(0, clockNow() - stretchStart);
    }

    function openStretch() {
        stretchStart = clockNow();
    }

    // --- UI ---
    function setUi(next) {
        mode = next;
        const idle = mode === 'idle';

        $('rec-pause').classList.toggle('hidden', mode !== 'recording');
        $('rec-resume').classList.toggle('hidden', mode !== 'paused');
        $('rec-stop').classList.toggle('hidden', idle);
        // The large button starts the recording and then sets markers; hidden while interrupted
        // (then "Weiter aufnehmen" takes its place).
        $('rec-main').classList.toggle('hidden', mode === 'interrupted');
        S.setIcon($('rec-main').querySelector('.icon'), idle ? 'mic' : 'flag');
        $('rec-focus-open').classList.toggle('hidden', idle);
        // Only made invisible, so the large button below the controls never moves.
        $('rec-dim-open').classList.toggle('is-invisible', idle || mode === 'interrupted');
        $('recorder').classList.toggle('is-recording', mode === 'recording');
        $('recorder').classList.toggle('is-paused', mode === 'paused' || mode === 'interrupted');
        // Sidebar and tab bar: a red dot at "Aufnahme" while a recording runs, on every page.
        document.documentElement.classList.toggle('is-recording', !idle);
        const stateText = { recording: 'Aufnahme läuft', paused: 'Pausiert', interrupted: 'Unterbrochen' }[mode] || '';
        $('rec-state').textContent = stateText || 'Bereit';
        if (!idle) $('rec-result').classList.add('hidden');
        updateStartButton();

        // Full-screen view
        const focus = $('rec-focus');
        focus.classList.toggle('is-recording', mode === 'recording');
        focus.classList.toggle('is-paused', mode === 'paused' || mode === 'interrupted');
        $('rec-focus-state').textContent = stateText;
        $('rec-focus-interrupted').classList.toggle('hidden', mode !== 'interrupted');
        $('rec-inline-interrupted').classList.toggle('hidden', mode !== 'interrupted');
        $('rec-focus-mark').classList.toggle('hidden', mode === 'interrupted');
        $('rec-focus-pause').textContent = mode === 'paused' ? 'Weiter' : 'Pause';
        $('rec-focus-pause').disabled = mode === 'interrupted';
        if (idle) { closeFocus(); setDim(false); }

        // Don't let a new file or transcription start in the middle of a recording.
        $('start-btn').disabled = !idle || !S.app.hasFile();
        $('drop-zone').classList.toggle('is-disabled', !idle);
    }

    function updateTimer() {
        const text = S.format.clock(recordedSeconds());
        $('rec-time').textContent = text;
        $('rec-focus-time').textContent = text;
        $('rec-dim-time').textContent = text;
        if (Date.now() - lastBackupUpdate > 5000) {
            lastBackupUpdate = Date.now();
            S.recordingBackup.updateMeta({ elapsedMs: recordedSeconds() * 1000, markers });
        }
    }

    function drawLevel() {
        if (!analyser) return;
        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        const level = recorder?.state === 'recording' ? Math.min(1, peak / 64) : 0;
        const transform = `scaleX(${level.toFixed(3)})`;
        $('rec-level-bar').style.transform = transform;
        $('rec-focus-level').style.transform = transform;
        levelFrame = requestAnimationFrame(drawLevel);
    }

    function renderMarkerInfo() {
        const own = markers.filter(m => m.kind === 'mark');
        const last = own[own.length - 1];
        const text = own.length
            ? `${own.length} Merker · zuletzt ${S.format.clock(last.time)}`
            : 'Noch keine Merker';
        $('rec-focus-markers').textContent = text;
        $('rec-markers-info').textContent = text;
    }

    async function keepAwake() {
        try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) { wakeLock = null; }
    }

    // --- Full-screen view ---
    function openFocus() {
        if (mode === 'idle') return;
        $('rec-focus').classList.remove('hidden');
        document.documentElement.classList.add('has-rec-focus');
        ($('rec-focus-mark').classList.contains('hidden') ? $('rec-continue') : $('rec-focus-mark')).focus();
    }

    function closeFocus() {
        if ($('rec-focus').classList.contains('hidden')) return;
        setDim(false);
        $('rec-focus').classList.add('hidden');
        document.documentElement.classList.remove('has-rec-focus');
        if (mode !== 'idle') $('rec-focus-open').focus();
    }

    let dimTrigger = null;
    function setDim(on) {
        const layer = $('rec-dim-layer');
        if (on === !layer.classList.contains('hidden')) return;
        if (on) dimTrigger = document.activeElement;
        layer.classList.toggle('hidden', !on);
        if (on) layer.focus();
        else dimTrigger?.focus?.();
    }

    // With a finished recording waiting, "Transkribieren" is the primary action and a new
    // recording becomes the secondary one.
    function updateStartButton() {
        const hasResult = !$('rec-result').classList.contains('hidden');
        const idle = mode === 'idle';
        $('rec-main').classList.toggle('is-secondary', idle && hasResult);
        $('rec-main-text').textContent = !idle ? 'Merker setzen' : hasResult ? 'Neue Aufnahme' : 'Aufnahme starten';
    }

    // --- Microphone and audio graph ---
    async function openMic() {
        stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
        const track = stream.getAudioTracks()[0];
        track?.addEventListener('ended', () => onMicLost(true));
        track?.addEventListener('mute', () => onMicLost(false));
        track?.addEventListener('unmute', onMicBack);
        if (audioCtx) {
            micSource = audioCtx.createMediaStreamSource(stream);
            micSource.connect(analyser);
            if (destination) micSource.connect(destination);
        }
    }

    function buildGraph() {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioCtx.resume?.().catch(() => {});  // may start suspended after the permission prompt
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 1024;
            destination = audioCtx.createMediaStreamDestination ? audioCtx.createMediaStreamDestination() : null;
            audioCtx.addEventListener('statechange', onContextState);
        } catch (_) {
            audioCtx = analyser = destination = null;
        }
    }

    // --- Interruptions (screen locked, app switched, call) ---
    function beginInterruption(needsMic) {
        if (interruption) {
            interruption.needsMic ||= needsMic;
            return;
        }
        closeStretch();
        interruption = { at: recordedBefore, since: Date.now(), needsMic };
        if (recorder?.state === 'recording') recorder.pause();
        setUi('interrupted');
        updateTimer();
    }

    function endInterruption() {
        if (!interruption) return;
        const gap = (Date.now() - interruption.since) / 1000;
        if (gap >= GAP_MIN_SECONDS) {
            const length = gap < 60 ? `${Math.round(gap)} s` : `${S.format.clock(gap).replace(/^00:/, '').replace(/^0/, '')} min`;
            markers.push({ time: interruption.at, label: `Unterbrechung (${length} ohne Ton)`, kind: 'gap' });
            S.recordingBackup.updateMeta({ markers });
        }
        interruption = null;
        if (recorder?.state === 'paused') recorder.resume();
        openStretch();
        setUi('recording');
        renderMarkerInfo();
    }

    function onMicLost(ended) {
        if (mode !== 'recording' && mode !== 'interrupted') return;
        beginInterruption(ended);
    }

    function onMicBack() {
        if (!interruption || interruption.needsMic) return;
        if (audioCtx && audioCtx.state !== 'running') return;  // wait for the context too
        endInterruption();
    }

    function onContextState() {
        if (!recorder || recorder.state === 'inactive') return;
        if (audioCtx.state === 'running') onMicBack();
        else if (mode === 'recording') beginInterruption(false);
    }

    // Try to continue on our own when the page is visible again; the button covers the rest.
    async function continueRecording() {
        if (!interruption) return;
        try {
            await audioCtx?.resume?.();
            const track = stream?.getAudioTracks()[0];
            if (interruption.needsMic || !track || track.readyState === 'ended') {
                if (!destination) throw new Error('no graph');
                micSource?.disconnect();
                stream?.getTracks().forEach(t => t.stop());
                await openMic();
                interruption.needsMic = false;
            }
            if (audioCtx && audioCtx.state !== 'running') throw new Error('audio suspended');
            endInterruption();
            keepAwake();
        } catch (_) {
            const text = 'Das Mikrofon lässt sich nicht automatisch wieder einschalten. Tippe auf „Weiter aufnehmen“.';
            $('rec-interrupted-text').textContent = text;
            $('rec-inline-interrupted-text').textContent = text;
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (!recorder || recorder.state === 'inactive') return;
        if (document.visibilityState !== 'visible') return;
        keepAwake();  // the wake lock is released when the tab is hidden
        if (interruption) continueRecording();
        else if (audioCtx && audioCtx.state !== 'running') audioCtx.resume?.().catch(() => {});
    });

    // --- Recording ---
    async function start() {
        if (S.dictation?.isActive()) {
            S.ui.setStatus('Unter „Diktat“ läuft gerade eine Aufnahme. Bitte zuerst beenden.', 'error');
            return;
        }
        if (pendingRecovery && !confirm('Es gibt noch eine unterbrochene Aufnahme. Beim Start einer neuen Aufnahme wird sie verworfen. Fortfahren?')) return;
        if (unsaved && !confirm('Die letzte Aufnahme wurde weder transkribiert noch gesichert. Trotzdem neu aufnehmen?')) return;
        if (!supported()) {
            S.ui.setStatus('Dieser Browser unterstützt keine Aufnahme über das Mikrofon.', 'error');
            return;
        }
        buildGraph();
        try {
            await openMic();
        } catch (err) {
            audioCtx?.close().catch(() => {});
            audioCtx = analyser = destination = null;
            const denied = err.name === 'NotAllowedError' || err.name === 'SecurityError';
            S.ui.setStatus(denied
                ? 'Kein Zugriff auf das Mikrofon. Bitte den Zugriff in den Browser-Einstellungen für diese Seite erlauben.'
                : `Mikrofon konnte nicht gestartet werden: ${err.message}`, 'error');
            return;
        }

        const mimeType = pickMimeType();
        const source = destination ? destination.stream : stream;
        recorder = new MediaRecorder(source, { ...(mimeType && { mimeType }), audioBitsPerSecond: BITRATE });
        chunks = [];
        markers = [];
        interruption = null;
        recorder.addEventListener('dataavailable', e => {
            if (!e.data.size) return;
            chunks.push(e.data);
            S.recordingBackup.addChunk(e.data);
        });
        recorder.addEventListener('stop', finish);
        hideRecovery();
        await S.recordingBackup.begin({ mime: recorder.mimeType || mimeType, startedAt: Date.now() });
        recorder.start(1000);  // hand over data every second – that's also the backup granularity
        drawLevel();

        recordedBefore = 0;
        openStretch();
        timer = setInterval(updateTimer, 250);
        updateTimer();
        renderMarkerInfo();
        keepAwake();
        setUi('recording');
        // The page shows the state; only a missing backup is worth a message.
        if (!S.recordingBackup.isAvailable()) {
            S.ui.setStatus('Dieser Browser erlaubt keine Sicherung der Aufnahme. Bitte den Tab nicht schließen, bis sie gestoppt ist.', 'error');
        }
    }

    function pause() {
        if (recorder?.state !== 'recording') return;
        closeStretch();
        recorder.pause();
        setUi('paused');
        updateTimer();
    }

    function resume() {
        if (recorder?.state !== 'paused' || mode !== 'paused') return;
        recorder.resume();
        openStretch();
        setUi('recording');
    }

    function stop() {
        if (!recorder || recorder.state === 'inactive') return;
        closeStretch();
        interruption = null;
        recorder.stop();  // → finish()
    }

    function addMarker() {
        if (!recorder || recorder.state === 'inactive' || mode === 'interrupted') return;
        const time = recordedSeconds();
        const n = markers.filter(m => m.kind === 'mark').length + 1;
        markers.push({ time, label: 'Merker ' + n, kind: 'mark' });
        S.recordingBackup.updateMeta({ markers });
        renderMarkerInfo();
        navigator.vibrate?.(30);
        for (const button of [$('rec-main'), $('rec-focus-mark')]) {
            button.classList.remove('is-confirmed');
            void button.offsetWidth;
            button.classList.add('is-confirmed');
        }
        const text = `Merker ${n} gesetzt bei ${S.format.clock(time)}`;
        $('rec-mark-live').textContent = text;
        $('rec-mark-inline-live').textContent = text;
    }

    function finish() {
        const mime = recorder.mimeType || pickMimeType() || 'audio/webm';
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        const duration = recordedBefore;
        const setMarkers = markers.slice();
        cleanup();
        setUi('idle');

        if (!blob.size) {
            S.ui.setStatus('Die Aufnahme ist leer – es kamen keine Audiodaten vom Mikrofon.', 'error');
            return;
        }
        lastRecording = new File([blob], fileName(mime), { type: blob.type });
        lastRecording.unisonoMarkers = setMarkers;
        unsaved = true;
        S.recordingBackup.clear();
        onRecorded(lastRecording);
        showResult(duration);   // the "Letzte Aufnahme" card replaces a status message
        $('rec-markers-info').textContent = 'Merker setzt du während der Aufnahme.';
    }

    function cleanup() {
        clearInterval(timer);
        cancelAnimationFrame(levelFrame);
        stream?.getTracks().forEach(t => t.stop());
        audioCtx?.removeEventListener('statechange', onContextState);
        audioCtx?.close().catch(() => {});
        wakeLock?.release().catch(() => {});
        stream = recorder = audioCtx = analyser = destination = micSource = wakeLock = null;
        chunks = [];
        markers = [];
        interruption = null;
        $('rec-level-bar').style.transform = 'scaleX(0)';
        $('rec-focus-level').style.transform = 'scaleX(0)';
        recordedBefore = 0;
        ['rec-time', 'rec-focus-time', 'rec-dim-time'].forEach(id => { $(id).textContent = '00:00:00'; });
    }

    // "Letzte Aufnahme": name, length, size, markers; transcribe or save it from here.
    function showResult(seconds) {
        if (!lastRecording) return;
        const count = (lastRecording.unisonoMarkers || []).filter(m => m.kind === 'mark').length;
        $('rec-result-name').textContent = lastRecording.name;
        $('rec-result-meta').textContent = [
            seconds ? S.format.clock(seconds) : null,
            `${(lastRecording.size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`,
            count ? `${count} Merker` : null
        ].filter(Boolean).join(' · ');
        $('rec-result').classList.remove('hidden');
        updateStartButton();
    }

    // Called by the app when the file for transcription changes: the card only belongs to
    // the recording while it is the chosen file.
    function fileChanged(file) {
        if (file !== lastRecording) $('rec-result').classList.add('hidden');
        updateStartButton();
    }

    function saveRecording() {
        if (!lastRecording) return;
        S.export.download(lastRecording, lastRecording.name, lastRecording.type);
        unsaved = false;
    }

    // Called by the app after a transcription, so closing the tab no longer warns.
    function markUsed(file) {
        if (file && file === lastRecording) unsaved = false;
    }

    // --- Recovery of an interrupted recording ---
    async function checkForInterrupted() {
        const found = await S.recordingBackup.find();
        if (!found) return;
        pendingRecovery = found;
        pendingDuration = found.elapsedMs ? found.elapsedMs / 1000 : 0;
        const when = new Date(found.startedAt);
        const date = when.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
        const time = when.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const kb = found.blob.size / 1024;
        const size = kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1).replace('.', ',')} MB`;
        const length = found.elapsedMs ? `, ca. ${S.format.clock(found.elapsedMs / 1000)}` : '';
        $('rec-recovery-text').textContent =
            `Eine Aufnahme vom ${date} um ${time} Uhr wurde nicht beendet (${size}${length}).`;
        $('rec-recovery').classList.remove('hidden');
        S.ui.setStatus('Eine unterbrochene Aufnahme wurde gefunden. Unter „Aufnahme“ lässt sie sich wiederherstellen.', 'note');
    }

    function hideRecovery() {
        if (pendingRecovery) S.ui.hideStatus();   // the hint about it is done
        pendingRecovery = null;
        $('rec-recovery').classList.add('hidden');
    }

    function restoreInterrupted() {
        if (!pendingRecovery) return;
        const { blob, mime, startedAt, markers: saved } = pendingRecovery;
        lastRecording = new File([blob], fileName(mime || blob.type, new Date(startedAt)), { type: blob.type });
        lastRecording.unisonoMarkers = Array.isArray(saved) ? saved : [];
        unsaved = true;
        hideRecovery();
        S.recordingBackup.clear();
        onRecorded(lastRecording);
        showResult(pendingDuration);
    }

    function discardInterrupted() {
        if (!confirm('Die unterbrochene Aufnahme endgültig verwerfen?')) return;
        hideRecovery();
        S.recordingBackup.clear();
    }

    function isActive() {
        return !!recorder && recorder.state !== 'inactive';
    }

    function init(options) {
        onRecorded = options.onRecorded;
        if (!supported()) {
            $('rec-main').disabled = true;
            $('rec-unsupported').classList.remove('hidden');
            return;
        }
        $('rec-main').addEventListener('click', () => (mode === 'idle' ? start() : addMarker()));
        $('rec-pause').addEventListener('click', pause);
        $('rec-resume').addEventListener('click', resume);
        $('rec-stop').addEventListener('click', stop);
        $('rec-focus-open').addEventListener('click', openFocus);
        $('rec-save').addEventListener('click', saveRecording);
        $('rec-transcribe').addEventListener('click', () => S.app.switchView('start'));
        $('rec-restore').addEventListener('click', restoreInterrupted);
        $('rec-discard').addEventListener('click', discardInterrupted);
        $('rec-continue').addEventListener('click', continueRecording);
        $('rec-inline-continue').addEventListener('click', continueRecording);

        $('rec-focus-mark').addEventListener('click', addMarker);
        $('rec-focus-pause').addEventListener('click', () => (mode === 'paused' ? resume() : pause()));
        $('rec-focus-stop').addEventListener('click', stop);
        $('rec-focus-close').addEventListener('click', closeFocus);
        $('rec-dim').addEventListener('click', () => setDim(true));
        $('rec-dim-open').addEventListener('click', () => setDim(true));
        $('rec-dim-layer').addEventListener('click', () => setDim(false));
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if (!$('rec-dim-layer').classList.contains('hidden')) { e.preventDefault(); setDim(false); }
            else if (!$('rec-focus').classList.contains('hidden')) { e.preventDefault(); closeFocus(); }
        });

        window.addEventListener('beforeunload', e => {
            if (isActive() || unsaved) { e.preventDefault(); e.returnValue = ''; }
        });
        checkForInterrupted();
    }

    // Settings → "Daten & Datenschutz": drop the backup without asking again.
    function discardBackup() {
        hideRecovery();
        return S.recordingBackup.clear();
    }

    S.recorder = { init, isActive, markUsed, discardBackup, fileChanged };
})(window.Unisono);

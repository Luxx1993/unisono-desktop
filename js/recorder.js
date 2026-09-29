/*
 * Microphone recorder for dictations and on-site meetings.
 *
 * Records with MediaRecorder (Opus/WebM where supported, AAC/MP4 on Safari), shows a timer
 * and input level, supports pause/resume, and keeps the screen awake while recording.
 * When stopped, the recording is handed to the app like an uploaded file (onRecorded).
 *
 * While recording, every second of audio is also written to IndexedDB (recording-backup.js),
 * so a recording interrupted by a closed tab or a crash can be restored on the next visit.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const $ = id => document.getElementById(id);
    const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
    const BITRATE = 64000; // ~0.5 MB per minute, plenty for speech

    let onRecorded = () => {};
    let stream = null;
    let recorder = null;
    let chunks = [];
    let startedAt = 0;
    let elapsedBefore = 0;  // ms recorded before the current (resumed) stretch
    let timer = null;
    let audioCtx = null;
    let analyser = null;
    let levelFrame = null;
    let wakeLock = null;
    let lastRecording = null;
    let unsaved = false;          // a finished recording that was neither transcribed nor saved
    let lastBackupUpdate = 0;
    let pendingRecovery = null;   // unfinished recording found in the backup on page load

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

    function elapsedMs() {
        return elapsedBefore + (recorder?.state === 'recording' ? Date.now() - startedAt : 0);
    }

    // --- UI state ---
    function setUi(mode) {
        // mode: 'idle' | 'recording' | 'paused'
        $('rec-start').classList.toggle('hidden', mode !== 'idle');
        $('rec-pause').classList.toggle('hidden', mode !== 'recording');
        $('rec-resume').classList.toggle('hidden', mode !== 'paused');
        $('rec-stop').classList.toggle('hidden', mode === 'idle');
        $('rec-live').classList.toggle('hidden', mode === 'idle');
        $('recorder').classList.toggle('is-recording', mode === 'recording');
        $('recorder').classList.toggle('is-paused', mode === 'paused');
        $('rec-state').textContent = mode === 'recording' ? 'Aufnahme läuft' : mode === 'paused' ? 'Pausiert' : '';
        // Don't let a new file or transcription start in the middle of a recording.
        $('start-btn').disabled = mode !== 'idle' || !S.app.hasFile();
        $('drop-zone').classList.toggle('is-disabled', mode !== 'idle');
    }

    function updateTimer() {
        $('rec-time').textContent = S.format.clock(elapsedMs() / 1000);
        if (Date.now() - lastBackupUpdate > 5000) {
            lastBackupUpdate = Date.now();
            S.recordingBackup.updateElapsed(elapsedMs());
        }
    }

    function drawLevel() {
        if (!analyser) return;
        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        const level = recorder?.state === 'recording' ? Math.min(1, peak / 64) : 0;
        $('rec-level-bar').style.transform = `scaleX(${level.toFixed(3)})`;
        levelFrame = requestAnimationFrame(drawLevel);
    }

    async function keepAwake() {
        try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) { wakeLock = null; }
    }

    // The wake lock is released when the tab is hidden; take it again when it returns.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && recorder && recorder.state !== 'inactive') keepAwake();
    });

    // --- Recording ---
    async function start() {
        if (pendingRecovery && !confirm('Es gibt noch eine unterbrochene Aufnahme. Beim Start einer neuen Aufnahme wird sie verworfen. Fortfahren?')) return;
        if (unsaved && !confirm('Die letzte Aufnahme wurde weder transkribiert noch gesichert. Trotzdem neu aufnehmen?')) return;
        if (!supported()) {
            S.ui.setStatus('Dieser Browser unterstützt keine Aufnahme über das Mikrofon.', 'error');
            return;
        }
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
        } catch (err) {
            const denied = err.name === 'NotAllowedError' || err.name === 'SecurityError';
            S.ui.setStatus(denied
                ? 'Kein Zugriff auf das Mikrofon. Bitte den Zugriff in den Browser-Einstellungen für diese Seite erlauben.'
                : `Mikrofon konnte nicht gestartet werden: ${err.message}`, 'error');
            return;
        }

        const mimeType = pickMimeType();
        recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: BITRATE });
        chunks = [];
        recorder.addEventListener('dataavailable', e => {
            if (!e.data.size) return;
            chunks.push(e.data);
            S.recordingBackup.addChunk(e.data);
        });
        recorder.addEventListener('stop', finish);
        hideRecovery();
        await S.recordingBackup.begin({ mime: recorder.mimeType || mimeType, startedAt: Date.now() });
        recorder.start(1000);  // hand over data every second – that's also the backup granularity

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtx.resume?.().catch(() => {});  // may start suspended after the permission prompt
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        drawLevel();

        elapsedBefore = 0;
        startedAt = Date.now();
        timer = setInterval(updateTimer, 250);
        updateTimer();
        keepAwake();
        setUi('recording');
        S.ui.setStatus(S.recordingBackup.isAvailable()
            ? 'Aufnahme läuft. Sie wird laufend im Browser gesichert und lässt sich nach einem Abbruch wiederherstellen.'
            : 'Aufnahme läuft. Achtung: Dieser Browser erlaubt keine Sicherung – bitte den Tab nicht schließen, bis sie gestoppt ist.');
    }

    function pause() {
        if (recorder?.state !== 'recording') return;
        recorder.pause();
        elapsedBefore += Date.now() - startedAt;
        setUi('paused');
        updateTimer();
    }

    function resume() {
        if (recorder?.state !== 'paused') return;
        recorder.resume();
        startedAt = Date.now();
        setUi('recording');
    }

    function stop() {
        if (!recorder || recorder.state === 'inactive') return;
        if (recorder.state === 'recording') elapsedBefore += Date.now() - startedAt;
        recorder.stop();  // → finish()
    }

    function finish() {
        const mime = recorder.mimeType || pickMimeType() || 'audio/webm';
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        const duration = elapsedBefore / 1000;
        cleanup();
        setUi('idle');

        if (!blob.size) {
            S.ui.setStatus('Die Aufnahme ist leer – es kamen keine Audiodaten vom Mikrofon.', 'error');
            return;
        }
        lastRecording = new File([blob], fileName(mime), { type: blob.type });
        unsaved = true;
        S.recordingBackup.clear();
        $('rec-save').classList.remove('hidden');
        onRecorded(lastRecording);
        S.ui.setStatus(`Aufnahme gespeichert (${S.format.clock(duration)}, ${(blob.size / (1024 * 1024)).toFixed(1)} MB). Jetzt transkribieren oder die Aufnahme sichern.`, 'success');
    }

    function cleanup() {
        clearInterval(timer);
        cancelAnimationFrame(levelFrame);
        stream?.getTracks().forEach(t => t.stop());
        audioCtx?.close().catch(() => {});
        wakeLock?.release().catch(() => {});
        stream = recorder = audioCtx = analyser = wakeLock = null;
        chunks = [];
        $('rec-level-bar').style.transform = 'scaleX(0)';
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
        const when = new Date(found.startedAt);
        const date = when.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
        const time = when.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const kb = found.blob.size / 1024;
        const size = kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1).replace('.', ',')} MB`;
        const length = found.elapsedMs ? `, ca. ${S.format.clock(found.elapsedMs / 1000)}` : '';
        $('rec-recovery-text').textContent =
            `Eine Aufnahme vom ${date} um ${time} Uhr wurde nicht beendet (${size}${length}).`;
        $('rec-recovery').classList.remove('hidden');
    }

    function hideRecovery() {
        pendingRecovery = null;
        $('rec-recovery').classList.add('hidden');
    }

    function restoreInterrupted() {
        if (!pendingRecovery) return;
        const { blob, mime, startedAt } = pendingRecovery;
        lastRecording = new File([blob], fileName(mime || blob.type, new Date(startedAt)), { type: blob.type });
        unsaved = true;
        hideRecovery();
        S.recordingBackup.clear();
        $('rec-save').classList.remove('hidden');
        onRecorded(lastRecording);
        S.ui.setStatus('Unterbrochene Aufnahme wiederhergestellt. Jetzt transkribieren oder über „Sichern“ speichern.', 'success');
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
            $('rec-start').disabled = true;
            $('rec-unsupported').classList.remove('hidden');
            return;
        }
        $('rec-start').addEventListener('click', start);
        $('rec-pause').addEventListener('click', pause);
        $('rec-resume').addEventListener('click', resume);
        $('rec-stop').addEventListener('click', stop);
        $('rec-save').addEventListener('click', saveRecording);
        $('rec-restore').addEventListener('click', restoreInterrupted);
        $('rec-discard').addEventListener('click', discardInterrupted);
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

    S.recorder = { init, isActive, markUsed, discardBackup };
})(window.Unisono);

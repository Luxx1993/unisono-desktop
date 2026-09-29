/*
 * Live progress while a transcription runs: steps (prepare → upload → process → done),
 * real upload percentage and speed, elapsed time, and a cancel button.
 * The panel replaces the start form (#start-form) until the run ends.
 */
window.Unisono = window.Unisono || {};

(function (S) {
    const $ = id => document.getElementById(id);
    const STEPS = ['prepare', 'upload', 'process', 'done'];

    let timer = null;
    let startedAt = 0;
    let stageStartedAt = 0;
    let current = null;
    let fileSize = 0;
    let uploadSamples = [];
    let onCancel = null;

    function clock(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    function mb(bytes) {
        return (bytes / 1024 / 1024).toFixed(1).replace('.', ',');
    }

    function setBar(fraction) {
        const bar = $('progress-bar');
        bar.classList.toggle('is-indeterminate', fraction == null);
        bar.style.transform = fraction == null ? '' : `scaleX(${Math.max(0.02, Math.min(1, fraction))})`;
    }

    function detail(step, text) {
        document.querySelector(`#progress-steps [data-step="${step}"] .progress-detail`).textContent = text || '';
    }

    function markSteps(active) {
        const index = STEPS.indexOf(active);
        document.querySelectorAll('#progress-steps li').forEach((li, i) => {
            li.classList.toggle('is-done', i < index || active === 'done');
            li.classList.toggle('is-active', i === index && active !== 'done');
        });
    }

    function tick() {
        const now = Date.now();
        $('progress-elapsed').textContent = clock(now - startedAt);
        if (current === 'process') detail('process', clock(now - stageStartedAt));
    }

    // → called by app.js; returns nothing, cancel arrives via onCancel.
    function begin({ file, provider, model, duration, cancel }) {
        const api = S.apis[provider];
        onCancel = cancel;
        startedAt = stageStartedAt = Date.now();
        fileSize = file.size;
        uploadSamples = [];
        current = null;
        STEPS.forEach(step => detail(step, ''));

        // The provider's color for the dot and the progress line (DESIGN.md: one line per provider).
        $('progress-panel').dataset.provider = provider;
        $('progress-file').textContent = file.name;
        const modelName = api.models.find(m => m.id === model)?.name.split(' (')[0] || model;
        $('progress-meta').textContent = [api.label, modelName, `${mb(file.size)} MB`, duration ? S.format.clock(duration) : null].filter(Boolean).join(' · ');
        $('progress-cancel').disabled = false;

        $('start-form').classList.add('hidden');
        $('progress-panel').classList.remove('hidden');
        stage('prepare', 'Datei wird geprüft …');
        clearInterval(timer);
        timer = setInterval(tick, 500);
        tick();
    }

    // stage: 'prepare' | 'upload' | 'start' | 'process'. 'start' (creating the job) counts as processing.
    function stage(name, text) {
        const step = name === 'start' ? 'process' : name;
        if (step !== current) {
            if (current === 'upload') detail('upload', `${mb(fileSize)} MB`);
            current = step;
            stageStartedAt = Date.now();
            markSteps(step);
            setBar(step === 'upload' ? 0 : step === 'prepare' ? 0.02 : null);
        }
        if (text) $('progress-text').textContent = text;
    }

    function upload(fraction) {
        if (current !== 'upload') stage('upload');
        const now = Date.now();
        uploadSamples.push([now, fraction * fileSize]);
        uploadSamples = uploadSamples.filter(([t]) => now - t < 4000);
        const [t0, b0] = uploadSamples[0];
        const speed = now > t0 ? (fraction * fileSize - b0) / ((now - t0) / 1000) : 0;
        const rest = speed > 0 ? (fileSize * (1 - fraction)) / speed : null;
        detail('upload', `${Math.round(fraction * 100)} %`);
        $('progress-text').textContent = `${mb(fraction * fileSize)} von ${mb(fileSize)} MB`
            + (speed > 0 ? ` · ${mb(speed)} MB/s` : '')
            + (rest != null && fraction < 1 ? ` · noch ca. ${clock(rest * 1000)}` : '');
        setBar(fraction);
    }

    function end() {
        clearInterval(timer);
        timer = null;
        onCancel = null;
        current = null;
        $('progress-panel').classList.add('hidden');
        $('start-form').classList.remove('hidden');
    }

    function isRunning() {
        return timer != null;
    }

    function init() {
        $('progress-cancel').addEventListener('click', () => {
            if (!onCancel) return;
            $('progress-cancel').disabled = true;
            $('progress-text').textContent = 'Wird abgebrochen …';
            onCancel();
        });
        window.addEventListener('beforeunload', e => {
            if (!isRunning()) return;
            e.preventDefault();
            e.returnValue = '';
        });
    }

    document.addEventListener('DOMContentLoaded', init);
    S.progress = { begin, stage, upload, end, isRunning };
})(window.Unisono);

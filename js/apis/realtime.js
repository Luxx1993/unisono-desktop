/*
 * Live transcription: the microphone is streamed to the provider while you speak, and the text
 * comes back piece by piece. ElevenLabs (Scribe Realtime), Deepgram (Nova, Flux), Mistral (Voxtral Realtime) and
 * Gladia (Solaria).
 *
 * Unisono.realtime.start({ provider, model, key, language, vocabulary, stream, onText, onError })
 *   → { stop() → Promise<final text>, cancel() }
 * onText(text, { final, partial }): the whole text so far – settled parts plus the current guess.
 *
 * Audio goes out as 16 kHz mono PCM16, the format both providers document for streaming. A browser
 * cannot set headers on a WebSocket, so the key travels the way each provider documents for browsers:
 * Deepgram reads it from the "token" subprotocol, Gladia returns a ready WebSocket address with a token, ElevenLabs
 * and Mistral take a short-lived token that the
 * page fetches with the key first (the key itself never goes into the socket URL or the subprotocol).
 *
 * The pure parts (resampling, PCM conversion, joining the text) are exported for Node tests.
 */
(function (root) {
    const RATE = 16000;

    // ---- Pure helpers ---------------------------------------------------------------------------
    // Averages the input samples that fall into each output sample (a simple low-pass for speech).
    function downsample(input, fromRate, toRate = RATE) {
        if (fromRate === toRate) return Float32Array.from(input);
        const ratio = fromRate / toRate;
        const out = new Float32Array(Math.floor(input.length / ratio));
        for (let i = 0; i < out.length; i++) {
            const start = Math.floor(i * ratio);
            const end = Math.min(input.length, Math.floor((i + 1) * ratio));
            let sum = 0;
            for (let j = start; j < end; j++) sum += input[j];
            out[i] = end > start ? sum / (end - start) : input[start] || 0;
        }
        return out;
    }

    function toPcm16(samples) {
        const out = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        return out;
    }

    function base64(bytes) {
        const u8 = new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
    }

    // The text so far: settled pieces plus the provider's current guess for what follows.
    function transcript() {
        const finals = [];
        let partial = '';
        const join = parts => parts.map(p => p.trim()).filter(Boolean).join(' ').replace(/\s+([,.!?;:])/g, '$1');
        return {
            settle(text) { if (String(text || '').trim()) finals.push(String(text)); partial = ''; },
            guess(text) { partial = String(text || ''); },
            // At the end an unsettled guess counts: the provider closed before confirming it.
            flush() { if (partial.trim()) finals.push(partial); partial = ''; },
            text: () => join([...finals, partial]),
            final: () => join(finals),
            partial: () => partial.trim()
        };
    }

    // Deepgram: the stream URL for a model (Flux speaks the turn-based v2 protocol).
    function deepgramUrl({ model, language, vocabulary = [], eu = false }) {
        const host = eu ? 'wss://api.eu.deepgram.com' : 'wss://api.deepgram.com';
        const lang = !language || language === 'auto' ? null : language;
        const p = new URLSearchParams({ model, encoding: 'linear16', sample_rate: String(RATE) });
        if (model.startsWith('flux')) {
            if (lang && model.endsWith('multi')) p.set('language_hint', lang.split('-')[0]);
            return `${host}/v2/listen?${p}`;
        }
        p.set('channels', '1');
        p.set('interim_results', 'true');
        p.set('punctuate', 'true');
        p.set('smart_format', 'true');
        // Nova-3 detects nothing while streaming; "multi" lets it follow the speaker's languages.
        p.set('language', lang || (model === 'nova-3' ? 'multi' : 'de'));
        if (model === 'nova-3') for (const term of vocabulary.slice(0, 50)) p.append('keyterm', term);
        return `${host}/v1/listen?${p}`;
    }

    function elevenLabsUrl({ model, language, token }) {
        const p = new URLSearchParams({ model_id: model, audio_format: 'pcm_16000', commit_strategy: 'vad', token });
        if (language && language !== 'auto') p.set('language_code', language.split('-')[0]);
        return `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${p}`;
    }

    // Mistral: message formats as the official SDK sends them (mistralai/client-python, extra/realtime).
    const mistralUrl = model => `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${encodeURIComponent(model)}`;
    const mistralSessionUpdate = (delayMs = null) => ({
        type: 'session.update',
        session: { audio_format: { encoding: 'pcm_s16le', sample_rate: RATE }, ...(delayMs ? { target_streaming_delay_ms: delayMs } : {}) }
    });
    const mistralAudio = pcm => ({ type: 'input_audio.append', audio: base64(pcm) });

    // Gladia: POST /v2/live in the EU region (Gladia's default; it is set explicitly so it stays that way). The answer
    // holds the WebSocket address with a session token. Solaria 1 is the only live model.
    const GLADIA_INIT_URL = 'https://api.gladia.io/v2/live?region=eu-west';
    function gladiaInit({ language, vocabulary = [] } = {}) {
        const lang = !language || language === 'auto' ? null : language.split('-')[0];
        const body = {
            encoding: 'wav/pcm', bit_depth: 16, sample_rate: RATE, channels: 1, model: 'solaria-1',
            language_config: { languages: lang ? [lang] : [], code_switching: false },
            messages_config: { receive_partial_transcripts: true, receive_final_transcripts: true }
        };
        // The list is compared with every spoken word, Gladia asks for a short one.
        const terms = vocabulary.filter(Boolean).slice(0, 100);
        if (terms.length) {
            body.realtime_processing = { custom_vocabulary: true, custom_vocabulary_config: { vocabulary: terms, default_intensity: 0.5 } };
        }
        return body;
    }

    const core = { RATE, downsample, toPcm16, base64, transcript, deepgramUrl, elevenLabsUrl, mistralUrl, mistralSessionUpdate, mistralAudio,
        GLADIA_INIT_URL, gladiaInit };
    if (typeof module !== 'undefined' && module.exports) module.exports = core;
    if (!root || !root.document) return;

    const S = root.Unisono = root.Unisono || {};

    // ---- Microphone → 16 kHz PCM16 in chunks of about 100 ms ---------------------------------------
    const WORKLET = `class Tap extends AudioWorkletProcessor {
        process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
    }
    registerProcessor('unisono-tap', Tap);`;

    async function capture(stream, onChunk) {
        const ctx = new (root.AudioContext || root.webkitAudioContext)();
        const source = ctx.createMediaStreamSource(stream);
        let pending = [];
        let pendingLength = 0;
        const chunkSamples = Math.round(ctx.sampleRate / 10);
        const push = samples => {
            pending.push(samples);
            pendingLength += samples.length;
            if (pendingLength >= chunkSamples) flush();
        };
        const flush = () => {
            if (!pendingLength) return;
            const all = new Float32Array(pendingLength);
            let offset = 0;
            for (const p of pending) { all.set(p, offset); offset += p.length; }
            pending = [];
            pendingLength = 0;
            onChunk(toPcm16(downsample(all, ctx.sampleRate)));
        };
        let node;
        if (ctx.audioWorklet) {
            const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
            try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
            node = new AudioWorkletNode(ctx, 'unisono-tap');
            node.port.onmessage = e => push(e.data);
        } else {
            node = ctx.createScriptProcessor(4096, 1, 1);
            node.onaudioprocess = e => push(e.inputBuffer.getChannelData(0).slice(0));
        }
        // Silent output: the node must be connected to run, but nothing should be heard.
        const mute = ctx.createGain();
        mute.gain.value = 0;
        source.connect(node);
        node.connect(mute).connect(ctx.destination);
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return {
            stop() {
                flush();
                try { source.disconnect(); node.disconnect(); } catch (_) {}
                if (node.port) node.port.onmessage = null;
                ctx.close().catch(() => {});
            }
        };
    }

    // ---- A WebSocket session with a buffer for audio captured before the provider is ready ------------
    // readyOnOpen: audio may flow as soon as the socket is open (Deepgram); otherwise onMessage calls markReady.
    function socketSession({ label, open, onMessage, sendAudio, finish, finishTimeoutMs = 5000, readyOnOpen = false, onText, onError }) {
        const text = transcript();
        let ws = null;
        let ready = false;
        let ended = false;
        let failed = null;
        let stopping = false;
        const queue = [];
        let resolveDone;
        const done = new Promise(resolve => { resolveDone = resolve; });
        const close = () => {
            if (ended) return;
            ended = true;
            text.flush();
            try { ws?.close(1000); } catch (_) {}
            resolveDone();
        };
        const fail = err => {
            if (ended) return;
            failed = err;
            onError?.(err);
            close();
        };
        const update = () => onText?.(text.text(), { final: text.final(), partial: text.partial() });
        const api = {
            text,
            update,
            fail,
            send: msg => { try { ws?.send(JSON.stringify(msg)); } catch (_) {} },
            markReady() {
                if (ready || ended) return;
                ready = true;
                while (queue.length) sendAudio(ws, queue.shift());
                // Stop was pressed while the provider was still getting ready: finish now.
                if (stopping) finish(ws, api);
            },
            close
        };

        (async () => {
            try {
                ws = await open();
                ws.binaryType = 'arraybuffer';
                ws.onmessage = e => {
                    let msg;
                    try { msg = JSON.parse(e.data); } catch (_) { return; }
                    onMessage(msg, api);
                };
                ws.onerror = () => fail(new Error(`${label}: Die Live-Verbindung ist fehlgeschlagen. Stimmt der Key, und ist das Modell freigeschaltet?`));
                ws.onclose = e => {
                    if (!ended && e.code !== 1000 && e.code !== 1005 && !text.final()) {
                        fail(new Error(`${label}: Live-Verbindung beendet (${e.code}${e.reason ? ' – ' + e.reason : ''}).`));
                    } else close();
                };
                if (ended) ws.close(1000);
                else if (readyOnOpen) api.markReady();
            } catch (err) {
                fail(err);
            }
        })();

        return {
            push(pcm) {
                if (ended) return;
                if (ready && ws?.readyState === 1) sendAudio(ws, pcm);
                else queue.push(pcm);
            },
            async stop() {
                if (!ended && !stopping) {
                    stopping = true;
                    // Not ready yet: markReady sends the waiting audio and finishes. Either way the session
                    // ends after a grace period, with whatever text has arrived.
                    if (ready && ws?.readyState === 1) finish(ws, api);
                    setTimeout(close, finishTimeoutMs + (ready ? 0 : 5000));
                }
                await done;
                if (failed && !text.final()) throw failed;
                return text.final();
            },
            cancel() {
                ended = true;
                try { ws?.close(1000); } catch (_) {}
                resolveDone();
            }
        };
    }

    // Opens a WebSocket and waits until it is open (or fails).
    function connect(url, protocols) {
        return new Promise((resolve, reject) => {
            const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
            ws.onopen = () => resolve(ws);
            ws.onerror = () => reject(new Error('Die Live-Verbindung ließ sich nicht öffnen. Stimmt der Key?'));
        });
    }

    // ---- Providers ---------------------------------------------------------------------------------
    const providers = {
        deepgram: {
            models: [
                { id: 'nova-3', name: 'Nova-3 (viele Sprachen)' },
                { id: 'nova-2', name: 'Nova-2' },
                { id: 'flux-general-multi', name: 'Flux (mehrsprachig, erkennt Sprechpausen)' },
                { id: 'flux-general-en', name: 'Flux (nur Englisch)' }
            ],
            open({ key, model, language, vocabulary, onText, onError }) {
                const eu = S.providerSettings?.get('deepgram', 'region') === 'eu';
                return socketSession({
                    label: 'Deepgram', onText, onError, readyOnOpen: true,
                    open: async () => connect(deepgramUrl({ model, language, vocabulary, eu }), ['token', key]),
                    onMessage(msg, s) {
                        if (msg.type === 'Results') {
                            const t = msg.channel?.alternatives?.[0]?.transcript || '';
                            if (msg.is_final) s.text.settle(t); else if (t) s.text.guess(t);
                            s.update();
                        } else if (msg.type === 'TurnInfo') {
                            if (msg.event === 'EndOfTurn') s.text.settle(msg.transcript); else if (msg.transcript) s.text.guess(msg.transcript);
                            s.update();
                        } else if (msg.type === 'Error' || msg.err_msg) {
                            s.fail(new Error('Deepgram: ' + (msg.description || msg.err_msg || 'Fehler bei der Live-Transkription.')));
                        }
                    },
                    sendAudio: (ws, pcm) => ws.send(pcm.buffer),
                    // Deepgram sends the last results and then closes the socket itself.
                    finish: ws => ws.send(JSON.stringify({ type: 'CloseStream' }))
                });
            }
        },
        gladia: {
            models: [{ id: 'solaria-1', name: 'Solaria 1' }],
            open({ key, language, vocabulary, onText, onError }) {
                return socketSession({
                    label: 'Gladia', onText, onError, readyOnOpen: true, finishTimeoutMs: 6000,
                    async open() {
                        const res = await fetch(GLADIA_INIT_URL, {
                            method: 'POST', headers: { 'x-gladia-key': key, 'Content-Type': 'application/json' },
                            body: JSON.stringify(gladiaInit({ language, vocabulary }))
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok || !data.url) {
                            throw new Error(`Gladia: Live-Zugang abgelehnt (HTTP ${res.status}${data?.message ? ' – ' + (Array.isArray(data.message) ? data.message.join(', ') : data.message) : ''}).`);
                        }
                        return connect(data.url);
                    },
                    onMessage(msg, s) {
                        if (msg.type === 'transcript') {
                            const text = msg.data?.utterance?.text || '';
                            // An event of the same utterance replaces the one before it; a final one settles it.
                            if (msg.data?.is_final) s.text.settle(text); else if (text) s.text.guess(text);
                            s.update();
                        } else if (msg.type === 'error' || msg.error) {
                            const e = msg.error || msg.data || {};
                            s.fail(new Error('Gladia: ' + (e.message || e.exception || 'Fehler bei der Live-Transkription.')));
                        }
                    },
                    sendAudio: (ws, pcm) => ws.send(pcm.buffer),
                    // The server processes what is left, then closes the socket itself.
                    finish: ws => ws.send(JSON.stringify({ type: 'stop_recording' }))
                });
            }
        },
        mistral: {
            models: [
                { id: 'voxtral-mini-transcribe-realtime-2602', name: 'Voxtral Mini Transcribe Realtime' },
                { id: 'voxtral-mini-transcribe-realtime-3-0', name: 'Voxtral Mini Transcribe Realtime 3 (neu)' }
            ],
            open({ key, model, onText, onError }) {
                let acc = '';
                return socketSession({
                    label: 'Mistral', onText, onError, finishTimeoutMs: 5000,
                    // A browser cannot send an Authorization header on a WebSocket, so a short-lived token (rt_…, bound to the
                    // model, valid about 15 minutes) is fetched with the key and passed as subprotocol.
                    async open() {
                        const res = await fetch('https://api.mistral.ai/v1/client/sessions', {
                            method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ purpose: 'realtime', model })
                        });
                        const data = await res.json().catch(() => ({}));
                        const token = data?.client_secret?.value;
                        if (!res.ok || !token) {
                            throw new Error(`Mistral: Live-Zugang abgelehnt (HTTP ${res.status}${data?.detail || data?.message ? ' – ' + (typeof (data.detail || data.message) === 'string' ? (data.detail || data.message) : JSON.stringify(data.detail || data.message)) : ''}).`);
                        }
                        return connect(mistralUrl(model), ['realtime', token]);
                    },
                    onMessage(msg, s) {
                        switch (msg.type) {
                            // The format goes first; audio captured meanwhile is replayed after it.
                            case 'session.created': s.send(mistralSessionUpdate()); s.markReady(); break;
                            case 'transcription.text.delta':
                                acc += msg.text || '';
                                s.text.guess(acc);
                                s.update();
                                break;
                            case 'transcription.done':
                                s.text.settle(msg.text || acc);
                                acc = '';
                                s.update();
                                s.close();
                                break;
                            case 'error': {
                                const detail = msg.error?.message ?? msg.error;
                                s.fail(new Error('Mistral: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail || msg))));
                                break;
                            }
                        }
                    },
                    sendAudio: (ws, pcm) => ws.send(JSON.stringify(mistralAudio(pcm))),
                    finish(ws) {
                        ws.send(JSON.stringify({ type: 'input_audio.flush' }));
                        ws.send(JSON.stringify({ type: 'input_audio.end' }));
                    }
                });
            }
        },
        elevenlabs: {
            models: [{ id: 'scribe_v2_realtime', name: 'Scribe v2 Realtime' }],
            open({ key, model, language, onText, onError }) {
                let committed = false;
                return socketSession({
                    label: 'ElevenLabs', onText, onError, finishTimeoutMs: 4000,
                    async open() {
                        const res = await fetch('https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', { method: 'POST', headers: { 'xi-api-key': key } });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok || !data.token) {
                            throw new Error(`ElevenLabs: Live-Zugang abgelehnt (HTTP ${res.status}${data?.detail?.message ? ' – ' + data.detail.message : ''}).`);
                        }
                        return connect(elevenLabsUrl({ model, language, token: data.token }));
                    },
                    onMessage(msg, s) {
                        const type = msg.message_type || '';
                        // Audio starts after this acknowledgement; what the microphone caught meanwhile is replayed.
                        if (type === 'session_started') s.markReady();
                        else if (type === 'partial_transcript') { if (msg.text) { s.text.guess(msg.text); s.update(); } }
                        else if (type === 'committed_transcript') {
                            s.text.settle(msg.text);
                            s.update();
                            if (committed) s.close();
                        } else if (/error/i.test(type)) {
                            s.fail(new Error('ElevenLabs: ' + (msg.error || msg.message || type)));
                        }
                    },
                    sendAudio: (ws, pcm) => ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: base64(pcm), commit: false, sample_rate: RATE })),
                    finish(ws, s) {
                        committed = true;
                        ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: RATE }));
                        // Nothing pending: the pause detection has already committed everything, no answer may come.
                        if (!s.text.partial()) setTimeout(s.close, 1500);
                    }
                });
            }
        }
    };

    async function start({ provider, model, key, language, vocabulary = [], stream, onText, onError }) {
        const p = providers[provider];
        if (!p) throw new Error('Dieser Anbieter kann nicht live mitschreiben.');
        const session = p.open({ key, model: model || p.models[0].id, language, vocabulary, onText, onError });
        const mic = await capture(stream, pcm => session.push(pcm));
        return {
            async stop() { mic.stop(); return session.stop(); },
            cancel() { mic.stop(); session.cancel(); }
        };
    }

    S.realtime = {
        ...core,
        providers,
        supports: id => !!providers[id],
        models: id => providers[id]?.models || [],
        start
    };
})(typeof window !== 'undefined' ? window : null);

/*
 * The look of the floating button of the Android app "diktat", for the floating dictation window:
 * - "Wolke": a glass sphere with coloured smoke in it, drawn by a WebGL shader (a port of the app's AGSL
 *   shader, AudioReactiveCloudOrbView.kt, and its motion, CloudMotion.kt). It breathes at rest, rises and
 *   flows faster with the voice while recording, shows a thin spinner while the text is on its way, and is
 *   tinted green or red for a moment when done or failed.
 * - "Welle": the app icon (a wave around a globe) as a line drawing in one ink colour (a port of
 *   DictateWaveOrbView.kt): still at rest, turning and breathing with the voice while recording, only
 *   turning while working, one soft pulse for done and a short shake for failed.
 *
 * Both are created for a window (the floating window is another document, so it has its own
 * requestAnimationFrame) and have the same calls:
 *   orb = Unisono.orbs.create('cloud' | 'wave', win, { size, palette, ink })
 *   orb.el            the element to put into the page
 *   orb.setPhase('idle' | 'recording' | 'working')
 *   orb.setLevel(0…1) voice level while recording
 *   orb.mark('success' | 'error')
 *   orb.setPalette(id) / orb.setInk(cssColor)
 *   orb.destroy()
 * With animations switched off in the system (prefers-reduced-motion) everything stands still.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const TAU = Math.PI * 2;

    // --- Cloud palettes, the five of the app (docs/design/diktat-design.md §4) ----------------------
    const PALETTES = [
        { id: 'lagoon', name: 'Lagune', colors: ['#9AD7E6', '#3FA9C8', '#1E6F8E', '#DDF4EF', '#86D3B7'] },
        { id: 'periwinkle', name: 'Periwinkle', colors: ['#B8C7F9', '#7A8FFB', '#5C63FB', '#E3EBFE', '#C9B8F9'] },
        { id: 'sage', name: 'Salbei', colors: ['#B5D9A8', '#6BA86F', '#2F6A52', '#EDF3CF', '#D2E48F'] },
        { id: 'sunset', name: 'Abendrot', colors: ['#EDBFCF', '#C96F9D', '#7B3F80', '#F8E1D2', '#EBA57E'] },
        { id: 'ink', name: 'Tinte', colors: ['#CFC8BF', '#6F6962', '#1F1C1A', '#F4F1EC', '#A59E96'] }
    ];
    const DEFAULT_PALETTE = 'lagoon';

    const paletteById = id => PALETTES.find(p => p.id === id) || PALETTES[0];

    function rgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
    }

    // The surface of the sphere read top to bottom, for controls cut from the same colours.
    const surfaceGradient = id => {
        const [o0, o1, , o3] = paletteById(id).colors;
        return `linear-gradient(160deg, ${o3}, ${o0} 50%, ${o1})`;
    };

    // --- CloudMotion.kt ------------------------------------------------------------------------------
    // Blobs in the sphere's unit square, each running its keyframes forth and back (CSS `alternate`).
    const LAYER_INSET = 0.25;
    const LAYER_SIZE = 1 + 2 * LAYER_INSET;
    const LAYER_TURN_SECONDS = 70;
    const SMOKE_TURN_SECONDS = 45;
    const BLUR = 8 / 90;
    const BLOBS = [
        { left: 0.08, top: 0.08, width: 0.60, height: 0.58, opacity: 1.0, idle: 26, listen: 6, mid: [0.12, 0.08, 1.10, 25], end: [-0.06, 0.12, 0.94, -15] },
        { left: 0.44, top: 0.30, width: 0.56, height: 0.62, opacity: 1.0, idle: 32, listen: 6, mid: [-0.14, -0.09, 1.12, -30], end: [0.07, -0.04, 0.96, 10] },
        { left: 0.12, top: 0.58, width: 0.66, height: 0.38, opacity: 0.7, idle: 21, listen: 21, mid: [0.10, -0.12, 1.08, 0], end: [-0.08, -0.04, 1.03, 0] },
        { left: 0.22, top: 0.24, width: 0.32, height: 0.32, opacity: 0.9, idle: 18, listen: 18, mid: [0.28, 0.20, 1.18, 0], end: [0.08, 0.34, 0.88, 0] }
    ];
    const IDENTITY = [0, 0, 1, 0];

    // CSS ease-in-out, cubic-bezier(0.42, 0, 0.58, 1).
    function easeInOut(x) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        const bez = (t, p1, p2) => { const u = 1 - t; return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t; };
        const bezD = (t, p1, p2) => { const u = 1 - t; return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2); };
        let t = x;
        for (let i = 0; i < 6; i++) {
            const d = bezD(t, 0.42, 0.58);
            if (Math.abs(d) < 1e-6) break;
            t = Math.min(1, Math.max(0, t - (bez(t, 0.42, 0.58) - x) / d));
        }
        return bez(t, 0, 1);
    }

    function blobAt(spec, phase) {
        const cycle = ((phase % 2) + 2) % 2;
        const progress = cycle <= 1 ? cycle : 2 - cycle;
        let from, to, local;
        if (progress < 0.5) { from = IDENTITY; to = spec.mid; local = progress * 2; }
        else { from = spec.mid; to = spec.end; local = (progress - 0.5) * 2; }
        const e = easeInOut(local);
        const lerp = i => from[i] + (to[i] - from[i]) * e;
        const cx = (spec.left + spec.width / 2 + lerp(0) * spec.width) * LAYER_SIZE - LAYER_INSET;
        const cy = (spec.top + spec.height / 2 + lerp(1) * spec.height) * LAYER_SIZE - LAYER_INSET;
        const scale = lerp(2);
        return {
            cx, cy,
            rx: spec.width / 2 * scale * LAYER_SIZE,
            ry: spec.height / 2 * scale * LAYER_SIZE,
            rotation: lerp(3) * Math.PI / 180,
            opacity: spec.opacity
        };
    }

    // The idle breath: 1 → 1.02 → 1 over 9 s.
    function breath(seconds) {
        const p = (seconds / 9) % 1;
        return 1 + 0.02 * easeInOut(p < 0.5 ? p * 2 : (1 - p) * 2);
    }

    // --- The cloud shader (AudioReactiveCloudOrbView.kt, AGSL → GLSL ES 1.00) ---------------------
    const VERTEX = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
    const FRAGMENT = `
precision highp float;
uniform float u_size; uniform float u_scale;
uniform vec4 u_a; uniform vec4 u_b; uniform vec4 u_c; uniform vec4 u_d;
uniform vec4 u_rot; uniform vec4 u_op;
uniform vec3 u_o0; uniform vec3 u_o1; uniform vec3 u_o2; uniform vec3 u_o3; uniform vec3 u_o4;
uniform float u_layerTurn; uniform float u_smokeTurn; uniform float u_time; uniform float u_blur;
uniform float u_grain; uniform vec3 u_tint; uniform float u_tintStrength;

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int o = 0; o < 3; o++) {
        v += a * noise(p);
        p = p * 2.0 + vec2(17.1, 9.4);
        a *= 0.5;
    }
    return v / 0.875;
}
vec2 turn(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
float cover(vec2 q, vec4 b, float rot) {
    vec2 d = turn(q - b.xy, -rot);
    float ln = max(length(d / b.zw), 0.0001);
    float dist = length(d) * (1.0 - 1.0 / ln);
    return 1.0 / (1.0 + exp(1.702 * dist / u_blur));
}
vec3 overlay(vec3 b, float s) {
    return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(vec3(0.5), b));
}
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 colorBlend(vec3 b, vec3 t) {
    vec3 c = t + (lum(b) - lum(t));
    float l = lum(c);
    float n = min(min(c.r, c.g), c.b);
    float x = max(max(c.r, c.g), c.b);
    if (n < 0.0) c = l + (c - l) * l / (l - n);
    if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
    return c;
}
void main() {
    vec2 fragCoord = vec2(gl_FragCoord.x, u_size - gl_FragCoord.y);
    vec2 uv = (fragCoord / u_size - 0.5) / u_scale + 0.5;
    vec2 c = uv - 0.5;
    float r = length(c);
    float aa = 1.2 / (u_size * u_scale);
    float edge = 1.0 - smoothstep(0.5 - aa, 0.5, r);
    if (edge <= 0.0) { gl_FragColor = vec4(0.0); return; }

    vec2 q = turn(c, -u_layerTurn) + 0.5;
    vec3 col = u_o0;
    col = mix(col, u_o1, cover(q, u_a, u_rot.x) * u_op.x);
    col = mix(col, u_o2, cover(q, u_b, u_rot.y) * u_op.y);
    col = mix(col, u_o3, cover(q, u_c, u_rot.z) * u_op.z);
    col = mix(col, u_o4, cover(q, u_d, u_rot.w) * u_op.w);

    vec2 s = turn(c, -(u_layerTurn - u_smokeTurn)) / 1.5 + 0.5;
    vec2 warp = vec2(
        fbm3(s * 3.0 + vec2(u_time * 0.16, -u_time * 0.10)),
        fbm3(s * 3.0 + vec2(-u_time * 0.12, u_time * 0.18) + 7.3)
    ) - 0.5;
    float smoke = fbm3(s * 5.0 + warp * 2.2 + vec2(0.0, -u_time * 0.22));
    col = mix(col, overlay(col, clamp(0.70 + (smoke - 0.5) * 1.1, 0.0, 1.0)), 0.58);

    float g = hash(floor(fragCoord / u_grain));
    col = mix(col, overlay(col, 0.732 + (g - 0.5) * 0.2), 0.4);

    col = mix(col, colorBlend(col, u_tint), 0.9 * clamp(u_tintStrength, 0.0, 1.0));

    float glass = max(0.0, 1.0 - length((uv - vec2(0.34, 0.17)) / vec2(0.20, 0.11)));
    col = mix(col, vec3(1.0), 0.6 * glass);
    float shade = max(0.0, 1.0 - length(uv - vec2(0.72, 0.82)) / 0.567);
    col = mix(col, vec3(0.031, 0.055, 0.157), 0.28 * shade);
    float rim = clamp((r - 0.4525) / 0.2546, 0.0, 1.0);
    col = mix(col, vec3(1.0), 0.28 * rim);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0) * edge, edge);
}`;

    const SUCCESS_TINT = [0x35 / 255, 0x7A / 255, 0x5B / 255];
    const ERROR_TINT = [0xB3 / 255, 0x44 / 255, 0x3A / 255];
    const LISTEN_MIN = 1.03;
    const LISTEN_MAX = 1.065;
    const BUTTON_SCALE = 0.75;          // the sphere's share of its box: room to rise while listening
    const ORB_ALPHA = 0.88;             // a little see-through, so the glass reads as glass
    const MARK_MS = 1700;
    const IDLE_FRAME_MS = 33;
    const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

    function reducedMotion(win) {
        return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    }

    // ================================ Cloud ================================================================
    function createCloud(win, { size = 160, palette = DEFAULT_PALETTE } = {}) {
        const doc = win.document;
        const root = doc.createElement('div');
        root.className = 'orb orb-cloud';
        root.style.width = root.style.height = size + 'px';
        const canvas = doc.createElement('canvas');
        const dpr = Math.min(win.devicePixelRatio || 1, 2);
        canvas.width = canvas.height = Math.round(size * dpr);
        canvas.style.cssText = `width:${size}px;height:${size}px;opacity:${ORB_ALPHA}`;
        const spinner = doc.createElement('span');
        spinner.className = 'orb-spinner';
        const glyph = doc.createElement('span');
        glyph.className = 'orb-glyph';
        glyph.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="g-ok" d="m5 12.5 4.5 4.5L19 7.5"/><path class="g-err" d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
        root.append(canvas, spinner, glyph);

        let colors = paletteById(palette).colors.map(rgb);
        let mode = 'idle';          // 'idle' | 'listening' | 'thinking' | 'success' | 'error'
        let level = 0, targetLevel = 0, scale = 1, tintLevel = 0, seconds = 0;
        let tint = SUCCESS_TINT;
        let paused = false, destroyed = false, markTimer = null, last = 0, frame = 0, lastDraw = 0;
        const phases = BLOBS.map((_, i) => (i * 0.37) % 1);
        const still = reducedMotion(win);

        let gl = null, program = null, loc = {};
        try {
            gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false }) || null;
            if (gl) {
                const compile = (type, src) => {
                    const sh = gl.createShader(type);
                    gl.shaderSource(sh, src);
                    gl.compileShader(sh);
                    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
                    return sh;
                };
                program = gl.createProgram();
                gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
                gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
                gl.linkProgram(program);
                if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
                gl.useProgram(program);
                const buffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
                const p = gl.getAttribLocation(program, 'p');
                gl.enableVertexAttribArray(p);
                gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
                for (const name of ['u_size', 'u_scale', 'u_a', 'u_b', 'u_c', 'u_d', 'u_rot', 'u_op', 'u_o0', 'u_o1', 'u_o2', 'u_o3', 'u_o4',
                    'u_layerTurn', 'u_smokeTurn', 'u_time', 'u_blur', 'u_grain', 'u_tint', 'u_tintStrength']) {
                    loc[name] = gl.getUniformLocation(program, name);
                }
                gl.viewport(0, 0, canvas.width, canvas.height);
            }
        } catch (err) {
            gl = null;
            console.warn('Wolke: Shader nicht verfügbar, einfache Darstellung', err);
        }
        if (!gl) {
            // Without WebGL: the ground colour with a soft light, flat but the same colours.
            canvas.style.display = 'none';
            const flat = doc.createElement('span');
            flat.className = 'orb-flat';
            root.prepend(flat);
            root.flat = flat;
        }

        function draw() {
            if (!gl) {
                root.flat.style.background = `radial-gradient(circle at 34% 20%, rgba(255,255,255,.75), transparent 38%), ${surfaceGradient(currentPalette)}`;
                root.flat.style.transform = `scale(${(BUTTON_SCALE * scale).toFixed(3)})`;
                return;
            }
            const blobs = BLOBS.map((spec, i) => blobAt(spec, phases[i]));
            const layerTurn = TAU * seconds / LAYER_TURN_SECONDS;
            const smokeTurn = TAU * seconds / SMOKE_TURN_SECONDS;
            gl.uniform1f(loc.u_size, canvas.width);
            gl.uniform1f(loc.u_scale, BUTTON_SCALE * scale);
            blobs.forEach((b, i) => gl.uniform4f(loc['u_' + 'abcd'[i]], b.cx, b.cy, b.rx, b.ry));
            gl.uniform4f(loc.u_rot, blobs[0].rotation, blobs[1].rotation, blobs[2].rotation, blobs[3].rotation);
            gl.uniform4f(loc.u_op, blobs[0].opacity, blobs[1].opacity, blobs[2].opacity, blobs[3].opacity);
            colors.forEach((c, i) => gl.uniform3f(loc['u_o' + i], c[0], c[1], c[2]));
            gl.uniform1f(loc.u_layerTurn, layerTurn);
            gl.uniform1f(loc.u_smokeTurn, smokeTurn);
            gl.uniform1f(loc.u_time, seconds);
            gl.uniform1f(loc.u_blur, BLUR);
            gl.uniform1f(loc.u_grain, Math.max(1, canvas.width * BUTTON_SCALE * scale / 160));
            gl.uniform3f(loc.u_tint, tint[0], tint[1], tint[2]);
            gl.uniform1f(loc.u_tintStrength, tintLevel);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        let currentPalette = palette;

        function step(now) {
            frame = 0;
            if (destroyed) return;
            const idleCalm = mode === 'idle' && tintLevel < 0.01 && Math.abs(level) < 0.01;
            if (idleCalm && now - lastDraw < IDLE_FRAME_MS) return schedule();
            const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
            last = now;
            lastDraw = now;
            if (!still && !paused) {
                level = damp(level, targetLevel, targetLevel > level ? 13 : 6, dt);
                tintLevel = damp(tintLevel, mode === 'success' || mode === 'error' ? 1 : 0, 7, dt);
                seconds += dt;
                const listening = mode === 'listening';
                BLOBS.forEach((spec, i) => { phases[i] += dt * (listening ? 1 / spec.listen : 2 / spec.idle); });
                const target = listening ? LISTEN_MIN + level * (LISTEN_MAX - LISTEN_MIN) : breath(seconds);
                scale = damp(scale, target, 8, dt);
            } else {
                scale = mode === 'listening' ? LISTEN_MIN : 1;
                tintLevel = mode === 'success' || mode === 'error' ? 1 : 0;
            }
            draw();
            if (!still) schedule();
        }

        function schedule() {
            if (!frame && !destroyed) frame = win.requestAnimationFrame(step);
        }

        function setMode(next) {
            if (mode === next) return;
            mode = next;
            last = 0;
            spinner.classList.toggle('is-on', next === 'thinking');
            if (still) { step(performance.now()); }
            schedule();
        }

        schedule();
        draw();

        return {
            el: root,
            setPhase(phase) {
                clearTimeout(markTimer);
                glyph.className = 'orb-glyph';
                if (phase === 'recording') setMode('listening');
                else if (phase === 'working') setMode('thinking');
                else { targetLevel = 0; setMode('idle'); }
            },
            setLevel(v) { targetLevel = Math.max(0, Math.min(1, v)); },
            setPaused(v) { paused = v; root.style.opacity = v ? 0.45 : 1; last = 0; schedule(); },
            mark(kind) {
                clearTimeout(markTimer);
                tint = kind === 'error' ? ERROR_TINT : SUCCESS_TINT;
                glyph.className = 'orb-glyph is-on ' + (kind === 'error' ? 'is-error' : 'is-success');
                setMode(kind === 'error' ? 'error' : 'success');
                markTimer = setTimeout(() => { glyph.className = 'orb-glyph'; setMode('idle'); }, MARK_MS);
            },
            setPalette(id) {
                currentPalette = paletteById(id).id;
                colors = paletteById(id).colors.map(rgb);
                last = 0;
                schedule();
                draw();
            },
            setInk() {},
            destroy() {
                destroyed = true;
                clearTimeout(markTimer);
                if (frame) win.cancelAnimationFrame(frame);
                gl?.getExtension('WEBGL_lose_context')?.loseContext();
                root.remove();
            }
        };
    }

    // ================================ Wave ================================================================
    // DiktatGlobeGeometry: a 48-unit box, an orthographic projection of a tilted sphere, a wave around it.
    const G = { BOX: 48, C: 24, R: 20.6, W_FRONT: 2.8, W_BACK: 1.3, A: 19, K: 3, TILT: 22, PHASE: 180, SAMPLES: 240, LOOP_MS: 6000 };
    const rad = d => d * Math.PI / 180;

    function project(lon, lat) {
        const lo = rad(lon), la = rad(lat), t = rad(G.TILT);
        const x = Math.cos(la) * Math.sin(lo);
        const y = Math.sin(la);
        const z = Math.cos(la) * Math.cos(lo);
        return { x: G.C + G.R * x, y: G.C - G.R * (y * Math.cos(t) - z * Math.sin(t)), z: y * Math.sin(t) + z * Math.cos(t) };
    }
    const latStatic = lon => G.A * Math.sin(rad(G.K * lon + G.PHASE));
    function latD(lon, tt) {
        const off = 120 * tt;
        const c = 0.5 - 0.5 * Math.cos(TAU * 2 * tt);
        let w = (Math.cos(rad(lon)) + 1) / 2;
        w = w * w * (3 - 2 * w);
        const cc = w * c + (1 - w) * (1 - c);
        return G.A * (1 - 0.35 * cc) * Math.sin(rad(G.K * (lon + off) + G.PHASE));
    }
    function widthForDepth(z) {
        let t = Math.min(1, Math.max(0, (z + 1) / 2));
        t = t * t * (3 - 2 * t);
        return G.W_BACK + (G.W_FRONT - G.W_BACK) * t;
    }

    function createWave(win, { size = 160, ink = '#1F1C1A' } = {}) {
        const doc = win.document;
        const root = doc.createElement('div');
        root.className = 'orb orb-wave';
        root.style.width = root.style.height = size + 'px';
        const canvas = doc.createElement('canvas');
        const dpr = Math.min(win.devicePixelRatio || 1, 2);
        canvas.width = canvas.height = Math.round(size * dpr);
        canvas.style.cssText = `width:${size}px;height:${size}px`;
        root.append(canvas);
        const ctx = canvas.getContext('2d');
        const still = reducedMotion(win);

        let inkColor = ink;
        let mode = 'idle';            // 'idle' | 'recording' | 'working'
        let turning = 0, breathing = 0, loopPos = 0, breathPhase = 0, level = 0, targetLevel = 0;
        let paused = false, destroyed = false, frame = 0, last = 0;
        let markKind = null, markStart = 0;
        const BODY = size * 0.62;
        const EASE_S = 0.45, BREATH_S = 2.6, BREATH_DEPTH = 0.06, LEVEL_DEPTH = 0.09;
        const STROKE = 0.86, PULSE_S = 0.6, PULSE_DEPTH = 0.1, SHAKE_S = 0.45, SHAKE_CYCLES = 3, SHAKE_REACH = 0.06;
        const approach = (v, t, s) => v < t ? Math.min(t, v + s) : v > t ? Math.max(t, v - s) : v;

        function points() {
            return Array.from({ length: G.SAMPLES + 1 }, (_, i) => {
                const lon = -180 + 360 * i / G.SAMPLES;
                const lat = turning <= 0 ? latStatic(lon)
                    : turning >= 1 ? latD(lon, loopPos)
                    : latStatic(lon) * (1 - turning) + latD(lon, loopPos) * turning;
                return project(lon, lat);
            });
        }

        function render(now) {
            const dt = last ? Math.min((now - last) / 1000, 0.064) : 0;
            last = now;
            const turnTarget = !still && mode !== 'idle' ? 1 : 0;
            const breathTarget = !still && mode === 'recording' ? 1 : 0;
            turning = approach(turning, turnTarget, dt / EASE_S);
            breathing = approach(breathing, breathTarget, dt / EASE_S);
            if (!paused) {
                if (turning > 0) loopPos = (loopPos + dt * 1000 / G.LOOP_MS) % 1;
                if (breathing > 0) breathPhase = (breathPhase + dt / BREATH_S) % 1;
            }
            level += (targetLevel - level) * 0.25;

            const age = (now - markStart) / 1000;
            let shiftX = 0, pulse = 1, markActive = false;
            if (!still && markKind === 'error' && age < SHAKE_S) {
                markActive = true;
                shiftX = Math.sin(TAU * SHAKE_CYCLES * age / SHAKE_S) * (1 - age / SHAKE_S) * SHAKE_REACH * BODY;
            } else if (!still && markKind === 'success' && age < PULSE_S) {
                markActive = true;
                pulse = 1 + PULSE_DEPTH * Math.sin(Math.PI * age / PULSE_S);
            }
            const breathScale = 1 + breathing * (BREATH_DEPTH + LEVEL_DEPTH * level) * Math.sin(TAU * breathPhase);
            const unit = BODY / (2 * G.R) * breathScale * pulse * dpr;
            const cx = canvas.width / 2 + shiftX * dpr;
            const cy = canvas.height / 2;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.lineCap = 'round';
            const dark = isDark(inkColor);
            const halo = dark ? 'rgba(255,255,255,0.27)' : 'rgba(0,0,0,0.27)';
            const pts = points();
            for (let pass = 0; pass < 2; pass++) {
                ctx.strokeStyle = pass === 0 ? halo : inkColor;
                const extra = pass === 0 ? 1.1 * unit : 0;
                for (let i = 0; i < pts.length - 1; i++) {
                    const a = pts[i], b = pts[i + 1];
                    ctx.lineWidth = widthForDepth((a.z + b.z) / 2) * unit * STROKE + extra;
                    ctx.beginPath();
                    ctx.moveTo(cx + (a.x - G.C) * unit, cy + (a.y - G.C) * unit);
                    ctx.lineTo(cx + (b.x - G.C) * unit, cy + (b.y - G.C) * unit);
                    ctx.stroke();
                }
                ctx.lineWidth = G.W_FRONT * unit * STROKE + extra;
                ctx.beginPath();
                ctx.arc(cx, cy, G.R * unit, 0, TAU);
                ctx.stroke();
            }
            const moving = !paused && (mode !== 'idle' || turning > 0 || breathing > 0);
            const easing = turning !== turnTarget || breathing !== breathTarget || level > 0.01;
            return !still && (moving || easing || markActive);
        }

        function isDark(color) {
            const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
            if (!m) {
                const rgbm = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
                return rgbm ? (+rgbm[1] * 0.3 + +rgbm[2] * 0.59 + +rgbm[3] * 0.11) < 128 : true;
            }
            const n = parseInt(m[1], 16);
            return ((n >> 16 & 255) * 0.3 + (n >> 8 & 255) * 0.59 + (n & 255) * 0.11) < 128;
        }

        function step(now) {
            frame = 0;
            if (destroyed) return;
            if (render(now)) schedule();
        }
        function schedule() { if (!frame && !destroyed) frame = win.requestAnimationFrame(step); }
        function kick() { last = 0; schedule(); }
        render(performance.now());

        return {
            el: root,
            setPhase(phase) {
                mode = phase === 'recording' ? 'recording' : phase === 'working' ? 'working' : 'idle';
                if (mode === 'idle') targetLevel = 0;
                kick();
            },
            setLevel(v) { targetLevel = Math.max(0, Math.min(1, v)); },
            setPaused(v) { paused = v; kick(); },
            mark(kind) { markKind = kind; markStart = performance.now(); kick(); },
            setPalette() {},
            setInk(color) { inkColor = color; kick(); },
            destroy() {
                destroyed = true;
                if (frame) win.cancelAnimationFrame(frame);
                root.remove();
            }
        };
    }

    function create(kind, win, options) {
        return kind === 'wave' ? createWave(win, options) : createCloud(win, options);
    }

    S.orbs = { create, PALETTES, DEFAULT_PALETTE, surfaceGradient, paletteById, blobAt, breath, easeInOut };
})(window.Unisono);

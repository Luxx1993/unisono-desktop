/*
 * Appearance: light/dark mode and design.
 *
 * Loaded without `defer` in <head>, so <html data-mode data-theme> is set before the page
 * paints (no flash of the wrong design). Each design is a complete design system in
 * css/designs/ (colors, type, corners, shadows, buttons, effects, motion). To add one, create
 * its CSS file, link it in index.html and add an entry to THEMES below.
 */
window.Scribe = window.Scribe || {};

(function (S) {
    const STORAGE_KEY = 'scribe_appearance';
    const FONT_URL = 'https://fonts.googleapis.com/css2?';

    // fonts: Google Fonts families loaded on demand (the default fonts are linked in index.html).
    const THEMES = [
        {
            id: 'deep',
            label: 'Deep Audio Precision',
            description: 'Glas und Leuchten: Nachtblau, Indigo-Verläufe, weiche Schatten, gleitende Bewegung.',
            fonts: null
        },
        {
            id: 'graphit',
            label: 'Graphit',
            description: 'Neo-Brutalismus: Tuschrahmen, harte Schatten, Neon-Limette, Buttons zum Drücken.',
            fonts: 'family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700'
        },
        {
            id: 'bernstein',
            label: 'Bernstein',
            description: 'Analog und warm: Serifen, Pillen-Buttons, runde Karten, Filmkorn, federnde Bewegung.',
            fonts: 'family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500;1,9..144,600&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500'
        },
        {
            id: 'swiss',
            label: 'Swiss',
            description: 'Editorial: eckig, flach, Punktraster, Versalien. Hell Papier und Waldgrün, dunkel Tinte und Gelb.',
            fonts: 'family=Schibsted+Grotesk:wght@400;500;600;700;800&family=Martian+Mono:wght@400;500;600'
        }
    ];
    const MODES = ['dark', 'light', 'system'];
    // Dark by default: the default design was made for it. "system" follows the OS setting.
    const DEFAULTS = { mode: 'dark', theme: 'deep' };
    // Earlier ids, so a saved choice survives the rename.
    const ALIASES = { amber: 'bernstein', 'swiss-signal': 'swiss', 'swiss-cobalt': 'swiss' };

    const listeners = new Set();
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    let current = load();

    function load() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) {}
        const theme = ALIASES[saved?.theme] || saved?.theme;
        return {
            mode: MODES.includes(saved?.mode) ? saved.mode : DEFAULTS.mode,
            theme: THEMES.some(t => t.id === theme) ? theme : DEFAULTS.theme
        };
    }

    function resolvedMode() {
        if (current.mode !== 'system') return current.mode;
        return media?.matches ? 'light' : 'dark';
    }

    // One <link> per design, added the first time the design is shown (settings previews too).
    function loadFonts(themeId) {
        const theme = THEMES.find(t => t.id === themeId);
        if (!theme?.fonts || document.getElementById('fonts-' + themeId)) return;
        const link = document.createElement('link');
        link.id = 'fonts-' + themeId;
        link.rel = 'stylesheet';
        link.href = FONT_URL + theme.fonts + '&display=swap';
        document.head.appendChild(link);
    }

    function apply() {
        const root = document.documentElement;
        root.dataset.mode = resolvedMode();
        root.dataset.theme = current.theme;
        loadFonts(current.theme);
        for (const fn of listeners) fn(get());
    }

    function set(changes) {
        current = { ...current, ...changes };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch (_) {}
        apply();
    }

    function get() {
        return { ...current, resolved: resolvedMode() };
    }

    media?.addEventListener?.('change', () => { if (current.mode === 'system') apply(); });

    S.appearance = {
        THEMES,
        MODES,
        get,
        loadFonts,
        setMode: mode => set({ mode }),
        setTheme: theme => set({ theme }),
        onChange: fn => listeners.add(fn)
    };

    apply();
})(window.Scribe);

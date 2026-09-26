/*
 * Appearance: light/dark mode and color theme.
 *
 * Loaded without `defer` in <head>, so <html data-mode data-theme> is set before the page
 * paints (no flash of the wrong theme). The colors themselves live in css/themes.css.
 * To add a theme, add its CSS blocks there and an entry to THEMES below.
 */
window.Scribe = window.Scribe || {};

(function (S) {
    const STORAGE_KEY = 'scribe_appearance';

    // swatch: background, surface, accent – only used for the preview in the settings dialog.
    const THEMES = [
        { id: 'deep', label: 'Deep Audio Precision', description: 'Nachtblau mit Indigo', swatch: { dark: ['#0a122a', '#212942', '#8083ff'], light: ['#f6f7fc', '#e0e4f4', '#6366f1'] } },
        { id: 'graphit', label: 'Graphit', description: 'Neutrales Grau mit Himmelblau', swatch: { dark: ['#111318', '#262a32', '#38bdf8'], light: ['#f6f7f9', '#dfe3e9', '#0ea5e9'] } },
        { id: 'amber', label: 'Bernstein', description: 'Warmes Braun mit Bernstein', swatch: { dark: ['#181410', '#312a23', '#eaa040'], light: ['#fbf8f3', '#e8dfd2', '#d97706'] } },
        { id: 'swiss', label: 'Swiss', description: 'Papier, Waldgrün und Signalrot · eckig, editorial', swatch: { dark: ['#1f3b2d', '#325543', '#e4572e'], light: ['#edeae3', '#1f3b2d', '#e4572e'] } }
    ];
    const MODES = ['dark', 'light', 'system'];
    // Dark by default: the design was made for it. "system" follows the OS setting.
    const DEFAULTS = { mode: 'dark', theme: 'deep' };

    const listeners = new Set();
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    let current = load();

    function load() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) {}
        return {
            mode: MODES.includes(saved?.mode) ? saved.mode : DEFAULTS.mode,
            theme: THEMES.some(t => t.id === saved?.theme) ? saved.theme : DEFAULTS.theme
        };
    }

    function resolvedMode() {
        if (current.mode !== 'system') return current.mode;
        return media?.matches ? 'light' : 'dark';
    }

    function apply() {
        const root = document.documentElement;
        root.dataset.mode = resolvedMode();
        root.dataset.theme = current.theme;
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
        setMode: mode => set({ mode }),
        setTheme: theme => set({ theme }),
        onChange: fn => listeners.add(fn)
    };

    apply();
})(window.Scribe);

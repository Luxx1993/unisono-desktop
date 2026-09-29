/*
 * Appearance: light, dark, or as the operating system says.
 *
 * Loaded without `defer` in <head>, so <html data-theme> is set before the page paints.
 * tokens.css does the rest: "system" leaves data-theme off and the prefers-color-scheme
 * block applies; "light" / "dark" set data-theme and override it.
 */
window.Unisono = window.Unisono || {};

(function (S) {
    const STORAGE_KEY = 'unisono_appearance';
    const MODES = ['light', 'dark', 'system'];
    const DEFAULT_MODE = 'system';

    const listeners = new Set();
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    let mode = load();

    function load() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) {}
        return MODES.includes(saved?.mode) ? saved.mode : DEFAULT_MODE;
    }

    function resolvedMode() {
        if (mode !== 'system') return mode;
        return media?.matches ? 'dark' : 'light';
    }

    function apply() {
        const root = document.documentElement;
        if (mode === 'system') delete root.dataset.theme;
        else root.dataset.theme = mode;
        for (const fn of listeners) fn(get());
    }

    function setMode(next) {
        mode = MODES.includes(next) ? next : DEFAULT_MODE;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode })); } catch (_) {}
        apply();
    }

    function get() {
        return { mode, resolved: resolvedMode() };
    }

    media?.addEventListener?.('change', () => { if (mode === 'system') apply(); });

    S.appearance = { MODES, get, setMode, onChange: fn => listeners.add(fn) };

    apply();
})(window.Unisono);

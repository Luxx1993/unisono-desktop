// Builds css/tailwind.css from the utility classes used in index.html and js/.
// Run `npm run build:css` after adding or changing Tailwind classes.
//
// Type roles follow the "Deep Audio Precision" design (shared with TranscribeLocal):
// Plus Jakarta Sans for headlines, Inter for text, JetBrains Mono for timecodes and labels.
module.exports = {
    content: ['./index.html', './js/**/*.js'],
    darkMode: 'class',
    theme: {
        extend: {
            // All colors come from css/themes.css, so light/dark mode and themes switch at runtime.
            colors: {
                'background': 'rgb(var(--c-bg) / <alpha-value>)',
                'surface-container-lowest': 'rgb(var(--c-surface-lowest) / <alpha-value>)',
                'surface-container-low': 'rgb(var(--c-surface-low) / <alpha-value>)',
                'surface-container': 'rgb(var(--c-surface) / <alpha-value>)',
                surface: 'rgb(var(--c-bg) / <alpha-value>)',
                'surface-container-high': 'rgb(var(--c-surface-high) / <alpha-value>)',
                'surface-container-highest': 'rgb(var(--c-surface-highest) / <alpha-value>)',
                'surface-bright': 'rgb(var(--c-surface-bright) / <alpha-value>)',
                'on-surface': 'rgb(var(--c-on-surface) / <alpha-value>)',
                'on-surface-variant': 'rgb(var(--c-on-surface-variant) / <alpha-value>)',
                'outline': 'rgb(var(--c-outline) / <alpha-value>)',
                'outline-variant': 'rgb(var(--c-outline-variant) / <alpha-value>)',
                'primary': 'rgb(var(--c-primary) / <alpha-value>)',
                'on-primary': 'rgb(var(--c-on-primary) / <alpha-value>)',
                'primary-container': 'rgb(var(--c-primary-container) / <alpha-value>)',
                'secondary': 'rgb(var(--c-secondary) / <alpha-value>)',
                'on-secondary': 'rgb(var(--c-on-secondary) / <alpha-value>)',
                'secondary-container': 'rgb(var(--c-secondary-container) / <alpha-value>)',
                'on-secondary-container': 'rgb(var(--c-on-secondary-container) / <alpha-value>)',
                'tertiary': 'rgb(var(--c-tertiary) / <alpha-value>)',
                'error': 'rgb(var(--c-error) / <alpha-value>)',
                'on-error': 'rgb(var(--c-on-error) / <alpha-value>)',
                'error-container': 'rgb(var(--c-error-container) / <alpha-value>)',
                'on-error-container': 'rgb(var(--c-on-error-container) / <alpha-value>)',
                'warning': 'rgb(var(--c-warning) / <alpha-value>)'
            },
            // Fonts and radii also come from css/themes.css, so a theme can change them.
            fontFamily: {
                display: 'var(--font-display)',
                headline: 'var(--font-display)',
                body: 'var(--font-body)',
                label: 'var(--font-mono)',
                code: 'var(--font-mono)'
            },
            borderRadius: {
                sm: 'var(--r-sm)',
                DEFAULT: 'var(--r-sm)',
                md: 'var(--r-md)',
                lg: 'var(--r-lg)',
                xl: 'var(--r-xl)',
                '2xl': 'var(--r-2xl)'
            }
        }
    }
};

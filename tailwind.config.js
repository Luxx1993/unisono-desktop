// Builds css/tailwind.css from the utility classes used in index.html and js/.
// Run `npm run build:css` after adding or changing Tailwind classes.
//
// Palette and type roles follow the "Deep Audio Precision" design (shared with TranscribeLocal):
// deep navy surfaces, indigo primary, emerald secondary, sky-blue tertiary;
// Plus Jakarta Sans for headlines, Inter for text, JetBrains Mono for timecodes and labels.
module.exports = {
    content: ['./index.html', './js/**/*.js'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                background: '#0a122a',
                surface: '#0a122a',
                'surface-bright': '#313852',
                'surface-container-lowest': '#050d25',
                'surface-container-low': '#131a33',
                'surface-container': '#171e37',
                'surface-container-high': '#212942',
                'surface-container-highest': '#2c344d',
                'on-surface': '#dbe1ff',
                'on-surface-variant': '#c7c4d7',
                outline: '#908fa0',
                'outline-variant': '#464554',
                primary: '#c0c1ff',
                'on-primary': '#1000a9',
                'primary-container': '#8083ff',
                'primary-fixed-dim': '#c0c1ff',
                secondary: '#4edea3',
                'on-secondary': '#003824',
                'secondary-container': '#00a572',
                'on-secondary-container': '#00311f',
                tertiary: '#7bd0ff',
                'on-tertiary': '#00354a',
                'tertiary-container': '#009bd1',
                error: '#ffb4ab',
                'on-error': '#690005',
                'error-container': '#93000a',
                'on-error-container': '#ffdad6'
            },
            fontFamily: {
                display: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
                headline: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
                body: ['Inter', 'system-ui', 'sans-serif'],
                label: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
                code: ['"JetBrains Mono"', 'ui-monospace', 'monospace']
            }
        }
    }
};

// Builds css/tailwind.css from the utility classes used in index.html and js/.
// Run `npm run build:css` after adding or changing Tailwind classes.
module.exports = {
    content: ['./index.html', './js/**/*.js'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                brand: { 50: '#f0f9ff', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1' }
            }
        }
    }
};

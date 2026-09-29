/*
 * Line icons from the sprite in index.html (<symbol id="i-…">), drawn in currentColor.
 * S.icon('close') → <svg class="icon"><use href="#i-close"></use></svg>
 * S.setIcon(svg, 'pause') swaps the symbol of an existing icon.
 */
window.Unisono = window.Unisono || {};

(function (S) {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    function icon(name, className = '') {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', ('icon ' + className).trim());
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', '#i-' + name);
        svg.append(use);
        return svg;
    }

    function setIcon(svg, name) {
        svg?.querySelector('use')?.setAttribute('href', '#i-' + name);
    }

    S.icon = icon;
    S.setIcon = setIcon;
})(window.Unisono);

/*
 * Technical-terms list ("Fachbegriffe"): one term per line, stored in this browser,
 * sent with every transcription so providers spell names and jargon correctly.
 *
 * Providers describe what they accept via api.vocabularySupport(model):
 *   { maxTerms, maxChars, maxWords, note } or null when the model has no vocabulary option.
 */
window.Scribe = window.Scribe || {};
(function (S) {
    const STORAGE_KEY = 'scribe_vocabulary';
    const ENABLED_KEY = 'scribe_vocabulary_enabled';
    const $ = id => document.getElementById(id);

    const listeners = new Set();
    let saveTimer = null;

    // Lines starting with '#' are comments, e.g. to group terms by project.
    function parse(text) {
        const seen = new Set();
        const terms = [];
        for (const line of text.split(/\r?\n/)) {
            const term = line.trim().replace(/\s+/g, ' ');
            if (!term || term.startsWith('#')) continue;
            const key = term.toLocaleLowerCase('de');
            if (seen.has(key)) continue;
            seen.add(key);
            terms.push(term);
        }
        return terms;
    }

    function isEnabled() {
        return $('vocab-enabled').checked;
    }

    function getTerms() {
        return isEnabled() ? parse($('vocab-text').value) : [];
    }

    // Applies a provider's limits. Terms that don't fit are reported, not silently dropped.
    // reasons: which limits actually removed terms ('chars' | 'words' | 'count').
    function prepare(terms, support) {
        if (!support || !terms.length) return { terms: [], skipped: [], reasons: [] };
        const skipped = [];
        const reasons = new Set();
        let kept = terms.filter(t => {
            const tooLong = support.maxChars && t.length > support.maxChars;
            const tooManyWords = support.maxWords && t.split(' ').length > support.maxWords;
            if (tooLong) reasons.add('chars');
            if (tooManyWords) reasons.add('words');
            if (tooLong || tooManyWords) skipped.push(t);
            return !tooLong && !tooManyWords;
        });
        if (support.maxTerms && kept.length > support.maxTerms) {
            reasons.add('count');
            skipped.push(...kept.slice(support.maxTerms));
            kept = kept.slice(0, support.maxTerms);
        }
        return { terms: kept, skipped, reasons: [...reasons] };
    }

    // Short explanation for the configuration panel.
    function describe(support) {
        const terms = getTerms();
        if (!terms.length) return '';
        if (!support) return 'Dieses Modell unterstützt keine Fachbegriffe – die Liste wird nicht mitgeschickt.';
        const { terms: kept, skipped, reasons } = prepare(terms, support);
        const parts = [kept.length === 1 ? '1 Fachbegriff wird mitgeschickt.' : `${kept.length} Fachbegriffe werden mitgeschickt.`];
        if (skipped.length) {
            const labels = {
                count: `max. ${support.maxTerms} Begriffe`,
                chars: `max. ${support.maxChars} Zeichen je Begriff`,
                words: support.maxWords === 1 ? 'nur Einzelwörter' : `max. ${support.maxWords} Wörter je Begriff`
            };
            const limits = reasons.map(r => labels[r]).join(', ');
            parts.push(`${skipped.length} übersprungen (${limits}): ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? ' …' : ''}`);
        }
        if (support.note) parts.push(support.note);
        return parts.join(' ');
    }

    function onChange(fn) {
        listeners.add(fn);
    }

    function changed() {
        updateCount();
        for (const fn of listeners) fn();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 400);
    }

    function updateCount() {
        const n = parse($('vocab-text').value).length;
        $('vocab-count').textContent = `${n} Begriff${n === 1 ? '' : 'e'}`;
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, $('vocab-text').value);
            localStorage.setItem(ENABLED_KEY, isEnabled() ? '1' : '0');
        } catch (_) {}
    }

    function load() {
        try {
            $('vocab-text').value = localStorage.getItem(STORAGE_KEY) || '';
            $('vocab-enabled').checked = localStorage.getItem(ENABLED_KEY) !== '0';
        } catch (_) {}
        updateCount();
    }

    // Import merges a .txt/.csv (one term per line, or separated by ; or ,) into the list.
    async function importFile(file) {
        if (!file) return;
        const text = await file.text();
        const incoming = parse(text.replace(/[;,\t]/g, '\n'));
        const existing = parse($('vocab-text').value);
        const known = new Set(existing.map(t => t.toLocaleLowerCase('de')));
        const added = incoming.filter(t => !known.has(t.toLocaleLowerCase('de')));
        const current = $('vocab-text').value.replace(/\s+$/, '');
        $('vocab-text').value = (current ? current + '\n' : '') + added.join('\n');
        changed();
        const dupes = incoming.length - added.length;
        const dupeText = dupes ? `, ${dupes} ${dupes === 1 ? 'war' : 'waren'} schon vorhanden` : '';
        S.ui.setStatus(`${added.length} neue${added.length === 1 ? 'r' : ''} Fachbegriff${added.length === 1 ? '' : 'e'} importiert${dupeText}.`, 'success');
    }

    function exportFile() {
        const text = $('vocab-text').value.trim();
        if (!text) return S.ui.setStatus('Die Fachbegriffsliste ist leer.', 'error');
        S.export.download(text + '\n', 'fachbegriffe.txt', 'text/plain;charset=utf-8');
    }

    function init() {
        load();
        $('vocab-text').addEventListener('input', changed);
        $('vocab-enabled').addEventListener('change', changed);
        $('vocab-import').addEventListener('click', () => $('vocab-file').click());
        $('vocab-file').addEventListener('change', e => { importFile(e.target.files[0]); e.target.value = ''; });
        $('vocab-export').addEventListener('click', exportFile);
        window.addEventListener('pagehide', save);
    }

    S.vocabulary = { init, getTerms, prepare, describe, onChange, parse };
})(window.Scribe);

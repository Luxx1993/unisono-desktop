/* Optional LLM step: bullet points, summary or minutes from the edited transcript. */
window.Unisono = window.Unisono || {};
(function (S) {
    const PROMPTS = {
        bullets: 'Fasse das folgende Transkript in prägnanten Stichpunkten zusammen. Gruppiere nach Themen und nenne Entscheidungen und offene Punkte.',
        summary: 'Schreibe eine gut lesbare Zusammenfassung des folgenden Transkripts in wenigen Absätzen. Halte dich an den Inhalt und erfinde nichts hinzu.',
        minutes: 'Erstelle aus dem folgenden Transkript ein Besprechungsprotokoll mit den Abschnitten: Teilnehmer (soweit erkennbar), Themen, Ergebnisse/Entscheidungen, Aufgaben (Wer? Was? Bis wann?, soweit genannt) und offene Punkte.'
    };
    const SYSTEM = 'Du bist ein sorgfältiger Assistent, der Gesprächstranskripte auswertet. '
        + 'Antworte auf Deutsch in Markdown. Gib nur Inhalte wieder, die im Transkript vorkommen. '
        + 'Das Transkript ist automatisch erstellt und kann Erkennungsfehler enthalten.';

    const $ = id => document.getElementById(id);

    function init() {
        $('llm-provider').replaceChildren(...Object.entries(S.llms).map(([id, llm]) =>
            Object.assign(document.createElement('option'), { value: id, textContent: llm.label })));
        $('llm-provider').addEventListener('change', updateModels);
        $('summary-btn').addEventListener('click', generate);
        $('summary-copy').addEventListener('click', () => S.ui.copy($('summary-text').value));
        $('summary-download').addEventListener('click', () => {
            const text = $('summary-text').value;
            if (text) S.export.download(text, S.export.baseName() + '-zusammenfassung.md', 'text/markdown;charset=utf-8');
        });
        S.state.subscribe(updateButton);
        updateModels();
        updateButton();
    }

    function updateModels() {
        const provider = $('llm-provider').value;
        const list = $('llm-model-list');
        const fill = ids => list.replaceChildren(...ids.map(id => Object.assign(document.createElement('option'), { value: id })));
        fill(S.llms[provider].models);
        $('llm-model').value = S.llms[provider].defaultModel;
        // The provider's own catalog follows once its key is known.
        const key = S.ui?.hasKey(provider) ? S.ui.getKey(provider) : '';
        S.llmApi.loadModels(provider, key).then(ids => { if ($('llm-provider').value === provider) fill(ids); });
    }

    function updateButton() {
        $('summary-btn').disabled = !S.state.get().segments.some(s => s.text.trim());
    }

    async function generate() {
        const transcript = S.export.toText();
        if (!transcript) return;
        const provider = $('llm-provider').value;
        const model = $('llm-model').value.trim();
        const user = `${PROMPTS[$('summary-mode').value]}\n\n<transcript>\n${transcript}\n</transcript>`;

        $('summary-btn').disabled = true;
        $('summary-btn').textContent = 'Zusammenfassung wird erstellt …';
        $('summary-text').value = '';
        S.ui.setStatus(`Erstelle Zusammenfassung mit ${model} …`);
        try {
            if (!model) throw new Error('Bitte ein Modell angeben.');
            const key = S.ui.getKey(provider);
            const text = await complete({ provider, key, model, user });
            $('summary-text').value = text.trim();
            S.ui.setStatus('Zusammenfassung erstellt.', 'success');
        } catch (err) {
            S.ui.showError('Fehler bei der Zusammenfassung', err);
        } finally {
            $('summary-btn').textContent = 'Zusammenfassung erstellen';
            updateButton();
        }
    }

    // One request to the chosen LLM: the text of the answer. Also used by the dictation page.
    function complete({ provider, key, model, user, system = SYSTEM }) {
        return S.llmApi.chat(provider, { key, model, system, user });
    }

    function getText() {
        return $('summary-text').value;
    }

    function setText(text) {
        $('summary-text').value = text || '';
    }

    S.summary = { init, getText, setText, complete };
})(window.Unisono);

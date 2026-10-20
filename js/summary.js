/*
 * Optional LLM step: bullet points, a summary or a protocol from a template (Baubesprechung, Begehung,
 * Telefonnotiz, Aktenvermerk; see protocol-core.js) from the edited transcript. Project, date,
 * speaker names, the project's people and the markers go along as context.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const core = S.protocolCore;
    const SYSTEM = 'Du bist ein sorgfältiger Assistent, der Gesprächstranskripte auswertet. '
        + 'Antworte auf Deutsch in Markdown. Gib nur Inhalte wieder, die im Transkript vorkommen. '
        + 'Das Transkript ist automatisch erstellt und kann Erkennungsfehler enthalten.';

    const $ = id => document.getElementById(id);

    function renderModes() {
        const select = $('summary-mode');
        const group = (label, id) => {
            const g = document.createElement('optgroup');
            g.label = label;
            g.append(...core.TEMPLATES.filter(t => t.group === id).map(t => Object.assign(document.createElement('option'), { value: t.id, textContent: t.name })));
            return g;
        };
        select.replaceChildren(group('Zusammenfassen', 'summary'), group('Protokoll-Vorlagen', 'protocol'));
        try { select.value = localStorage.getItem('unisono_summary_mode') || 'bullets'; } catch (_) {}
        if (!select.value) select.value = 'bullets';
        select.addEventListener('change', () => { try { localStorage.setItem('unisono_summary_mode', select.value); } catch (_) {} });
    }

    // What the AI should know besides the transcript.
    function context() {
        const { project, speakers, segments, markers, createdAt } = S.state.get();
        const used = new Set(segments.map(s => s.speaker));
        const p = S.people?.activeProject();
        return {
            project: project?.name || null,
            date: createdAt ? new Date(createdAt).toLocaleDateString('de-DE') : null,
            speakers: speakers.filter(s => used.has(s.id)).map(s => s.name),
            people: p?.people || [],
            markers: markers.map(m => ({ time: S.format.clock(m.time), label: m.label }))
        };
    }

    const selection = () => ({ provider: $('llm-provider').value, model: $('llm-model').value.trim() });

    function init() {
        renderModes();
        refresh();
        $('llm-provider').addEventListener('change', () => updateModels());
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

    // Only providers with a key are offered; a key saved on the key page shows up here at once.
    function refresh() {
        const select = $('llm-provider');
        const previous = select.value;
        const ids = Object.keys(S.llms).filter(id => !S.ui || S.ui.hasKey(id));
        select.replaceChildren(...(ids.length ? ids : ['']).map(id =>
            Object.assign(document.createElement('option'), { value: id, textContent: id ? S.llms[id].label : 'Zuerst einen API-Key eintragen' })));
        select.disabled = !ids.length;
        if (ids.includes(previous)) select.value = previous;
        // A different provider resets the model (and the logo, see app.js); the same one keeps what was typed.
        if (select.value !== previous) select.dispatchEvent(new Event('change'));
        else updateModels(true);
    }

    function updateModels(keepModel = false) {
        const provider = $('llm-provider').value;
        const select = $('llm-model');
        if (!provider) { select.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'Zuerst einen API-Key eintragen' })); select.disabled = true; return; }
        const key = S.ui?.hasKey(provider) ? S.ui.getKey(provider) : '';
        const current = keepModel && select.dataset.provider === provider ? select.value : S.llms[provider].defaultModel;
        S.llmApi.fillModelSelect(select, provider, key, current);
    }

    function updateButton() {
        $('summary-btn').disabled = !S.state.get().segments.some(s => s.text.trim());
    }

    async function generate() {
        const transcript = S.export.toText();
        if (!transcript) return;
        const provider = $('llm-provider').value;
        const model = $('llm-model').value.trim();
        const user = core.buildPrompt($('summary-mode').value, transcript, context());

        $('summary-btn').disabled = true;
        $('summary-btn').textContent = 'Wird erstellt …';
        $('summary-text').value = '';
        const kind = core.findTemplate($('summary-mode').value).name;
        S.ui.setStatus(`Erstelle „${kind}“ mit ${model} …`);
        try {
            if (!model) throw new Error('Bitte ein Modell angeben.');
            const key = S.ui.getKey(provider);
            const text = await complete({ provider, key, model, user });
            $('summary-text').value = text.trim();
            S.ui.setStatus(`„${kind}“ erstellt.`, 'success');
        } catch (err) {
            S.ui.showError('Fehler bei der Zusammenfassung', err);
        } finally {
            $('summary-btn').textContent = 'Erstellen';
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

    S.summary = { init, refresh, getText, setText, complete, context, selection };
})(window.Unisono);

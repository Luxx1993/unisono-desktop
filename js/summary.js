/* Optional LLM step: bullet points, summary or minutes from the edited transcript. */
window.Scribe = window.Scribe || {};
(function (S) {
    const MODELS = {
        anthropic: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
        openai: ['gpt-5', 'gpt-5-mini']
    };
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
        list.replaceChildren(...MODELS[provider].map(id => Object.assign(document.createElement('option'), { value: id })));
        $('llm-model').value = MODELS[provider][0];
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
        $('summary-text').value = '';
        S.ui.setStatus(`Erstelle Zusammenfassung mit ${model} …`);
        try {
            if (!model) throw new Error('Bitte ein Modell angeben.');
            const key = S.ui.getKey(provider);
            const text = provider === 'anthropic'
                ? await viaAnthropic(key, model, user)
                : await viaOpenAI(key, model, user);
            $('summary-text').value = text.trim();
            S.ui.setStatus('Zusammenfassung erstellt.', 'success');
        } catch (err) {
            S.ui.showError('Fehler bei der Zusammenfassung', err);
        } finally {
            updateButton();
        }
    }

    async function viaAnthropic(key, model, user) {
        const headers = {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'content-type': 'application/json'
        };
        const body = { model, max_tokens: 16000, system: SYSTEM, messages: [{ role: 'user', content: user }] };
        // On a safety decline, let the API re-run the request on a fallback model instead of stopping.
        if (['claude-opus-5', 'claude-fable-5-1'].includes(model)) {
            headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
            body.fallbacks = 'default';
        }
        const data = await S.http.fetchJson('https://api.anthropic.com/v1/messages', {
            method: 'POST', headers, body: JSON.stringify(body)
        }, 'Anthropic');

        if (data.stop_reason === 'refusal') {
            throw new Error('Anfrage wurde vom Modell abgelehnt' + (data.stop_details?.explanation ? ': ' + data.stop_details.explanation : '.'));
        }
        const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
        return data.stop_reason === 'max_tokens' ? text + '\n\n[… Ausgabe wegen Längenlimit abgeschnitten]' : text;
    }

    async function viaOpenAI(key, model, user) {
        const data = await S.http.fetchJson('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }]
            })
        }, 'OpenAI');
        return data.choices?.[0]?.message?.content || '';
    }

    S.summary = { init };
})(window.Scribe);

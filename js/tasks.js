/*
 * The task list of a transcript: who does what by when. The AI finds the tasks in the transcript
 * ("Aufgaben erkennen", with the provider and model of the summary card); every task can also be
 * typed in or changed by hand. Owners are suggested from the project's people (#people-list).
 * The tasks belong to the transcript (state.tasks): they are saved with it, in the archive and in the
 * project file, and appear in the Markdown and HTML exports.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const $ = id => document.getElementById(id);
    const core = S.protocolCore;

    function el(tag, props = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v == null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else if (k in node && k !== 'list') node[k] = v;
            else node.setAttribute(k, v);
        }
        node.append(...children.filter(c => c != null && c !== false));
        return node;
    }

    function row(task) {
        const done = el('input', { type: 'checkbox', checked: task.done, 'aria-label': 'Erledigt' });
        done.addEventListener('change', () => { S.state.updateTask(task.id, { done: done.checked }); li.classList.toggle('is-done', done.checked); updateCount(); });
        const text = el('textarea', { class: 'input task-text', rows: 1, value: task.text, 'aria-label': 'Aufgabe', spellcheck: true });
        text.addEventListener('input', () => { S.state.updateTask(task.id, { text: text.value }); fit(text); });
        const owner = el('input', { class: 'input', value: task.owner, placeholder: 'Verantwortlich', list: 'people-list', 'aria-label': 'Verantwortlich', autocomplete: 'off' });
        owner.addEventListener('input', () => S.state.updateTask(task.id, { owner: owner.value }));
        // A date picker when the due date is a date; free text ("nächste Woche") stays text.
        const due = el('input', { class: 'input', value: task.due, placeholder: 'Frist', 'aria-label': 'Frist (Datum oder Text)', autocomplete: 'off',
            type: !task.due || core.isoDate(task.due) ? 'date' : 'text' });
        due.addEventListener('change', () => S.state.updateTask(task.id, { due: due.value }));
        const remove = el('button', { type: 'button', class: 'icon-btn is-small', 'aria-label': 'Aufgabe löschen', title: 'Löschen',
            onclick: () => S.state.removeTask(task.id) }, S.icon('close'));
        const li = el('li', { class: 'task-row' + (task.done ? ' is-done' : ''), 'data-task': task.id },
            done, el('div', { class: 'task-fields' }, text, el('div', { class: 'task-meta' }, owner, due)), remove);
        requestAnimationFrame(() => fit(text));
        return li;
    }

    function fit(area) {
        area.style.height = 'auto';
        area.style.height = area.scrollHeight + 'px';
    }

    function render() {
        const { tasks, segments } = S.state.get();
        $('task-list').replaceChildren(...tasks.map(row));
        $('task-empty').classList.toggle('hidden', tasks.length > 0);
        $('task-find').disabled = !segments.some(s => s.text.trim()) || busy;
        $('task-add').disabled = !segments.length;
        ['task-copy', 'task-csv'].forEach(id => { $(id).disabled = !tasks.length; });
        updateCount();
    }

    function updateCount() {
        const tasks = S.state.get().tasks;
        const open = tasks.filter(t => !t.done).length;
        $('task-count').textContent = tasks.length ? `${open} offen · ${tasks.length}` : '';
    }

    let busy = false;
    async function find() {
        const transcript = S.export.toText();
        if (!transcript || busy) return;
        const { provider, model } = S.summary.selection();
        busy = true;
        $('task-find').disabled = true;
        $('task-find').textContent = 'Aufgaben werden gesucht …';
        S.ui.setStatus(`Suche Aufgaben mit ${model} …`);
        try {
            if (!provider) throw new Error('Bitte zuerst unter „API-Keys“ einen Key für eine KI eintragen.');
            if (!model) throw new Error('Bitte unter „Zusammenfassung“ ein Modell wählen.');
            const answer = await S.summary.complete({
                provider, key: S.ui.getKey(provider), model,
                system: 'Du liest Gesprächstranskripte und gibst Aufgaben als JSON zurück. Das Transkript ist automatisch erstellt und kann Erkennungsfehler enthalten.',
                user: core.buildTaskPrompt(transcript, S.summary.context())
            });
            const found = core.mergeTasks(S.state.get().tasks, core.parseTasks(answer));
            const added = S.state.addTasks(found);
            S.ui.setStatus(added ? `${added} Aufgabe${added === 1 ? '' : 'n'} gefunden.` : 'Keine neuen Aufgaben gefunden.', added ? 'success' : 'note');
        } catch (err) {
            S.ui.showError('Aufgaben erkennen nicht möglich', err);
        } finally {
            busy = false;
            $('task-find').textContent = 'Aufgaben erkennen';
            render();
        }
    }

    function init() {
        $('task-find').addEventListener('click', find);
        $('task-add').addEventListener('click', () => {
            const id = S.state.addTask();
            const area = document.querySelector(`.task-row[data-task="${id}"] .task-text`);
            area?.focus();
            area?.select();
        });
        $('task-copy').addEventListener('click', () => S.ui.copy(core.tasksToMarkdown(S.state.get().tasks)));
        $('task-csv').addEventListener('click', () => S.export.download(core.tasksToCsv(S.state.get().tasks), S.export.baseName() + '-aufgaben.csv', 'text/csv;charset=utf-8'));
        // Typing in a task only updates that task; the list is rebuilt for everything else.
        S.state.subscribe((type, detail) => {
            if (type === 'tasks' && detail) return;
            if (type === 'tasks' || type === 'reset' || type === 'segments') render();
        });
        render();
    }

    S.tasks = { init };
})(window.Unisono);

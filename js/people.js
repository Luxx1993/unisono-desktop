/*
 * Projects and the people who keep coming up in them (site meetings with the same client, architect,
 * contractors). Stored per browser in localStorage 'unisono_projects':
 *   [{ id, name, people: [{ name, role }] }]
 * plus the current project ('unisono_current_project'), which new transcripts belong to.
 *
 * What the people are good for:
 * - their names go to the speech engine as technical terms, so they are spelled right,
 * - the speaker names and the task owners in the transcript suggest them (datalist #people-list),
 * - protocols and the task list get them as context (with role or company).
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const $ = id => document.getElementById(id);
    const KEY = 'unisono_projects';
    const CURRENT_KEY = 'unisono_current_project';

    let projects = [];
    let currentId = '';
    const listeners = new Set();

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

    const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    function load() {
        try {
            const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
            projects = (Array.isArray(raw) ? raw : []).filter(p => p && p.id && p.name).map(p => ({
                id: String(p.id), name: String(p.name),
                people: (Array.isArray(p.people) ? p.people : []).filter(x => x && x.name).map(x => ({ name: String(x.name), role: String(x.role || '') }))
            }));
            currentId = localStorage.getItem(CURRENT_KEY) || '';
        } catch (_) { projects = []; }
        if (!projects.some(p => p.id === currentId)) currentId = '';
    }

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify(projects));
            if (currentId) localStorage.setItem(CURRENT_KEY, currentId); else localStorage.removeItem(CURRENT_KEY);
        } catch (_) {}
        for (const fn of listeners) fn();
    }

    const get = id => projects.find(p => p.id === id) || null;
    const current = () => get(currentId);

    // The project of the open transcript, else the current one.
    function activeProject() {
        const p = S.state.get().project;
        return (p && get(p.id)) || (p ? { id: p.id, name: p.name, people: [] } : null);
    }

    function people(projectId) {
        return get(projectId)?.people || [];
    }

    // Names for the speech engine: the people of the current project.
    const vocabularyNames = () => (current()?.people || []).map(p => p.name);

    function setCurrent(id) {
        currentId = get(id) ? id : '';
        save();
        render();
    }

    // --- The datalist behind speaker names and task owners -------------------------------------------
    function renderDatalist() {
        const list = $('people-list');
        if (!list) return;
        const names = new Set(['Ich', ...(activeProject()?.people || []).map(p => p.name)]);
        list.replaceChildren(...[...names].map(name => {
            const p = (activeProject()?.people || []).find(x => x.name === name);
            return el('option', { value: name, label: p?.role || '' });
        }));
    }

    // --- Project selects (transcript header, file page) -----------------------------------------------
    function fillSelect(select, value, emptyText) {
        select.replaceChildren(el('option', { value: '', text: emptyText }),
            ...projects.map(p => el('option', { value: p.id, text: p.name })));
        // A project from a file or the archive that this browser does not know: show it anyway.
        if (value && !get(value)) select.append(el('option', { value, text: S.state.get().project?.name || value }));
        select.value = value || '';
    }

    function renderSelects() {
        if ($('project-select-start')) fillSelect($('project-select-start'), currentId, 'Kein Projekt');
        if ($('transcript-project')) fillSelect($('transcript-project'), S.state.get().project?.id || '', 'Kein Projekt');
    }

    // --- The page "Projekte" ------------------------------------------------------------------------
    function render() {
        renderSelects();
        renderDatalist();
        const host = $('project-list');
        if (!host) return;
        $('project-empty').classList.toggle('hidden', projects.length > 0);
        host.replaceChildren(...projects.map(projectCard));
    }

    function projectCard(project) {
        const isCurrent = project.id === currentId;
        const name = el('input', { class: 'input project-name', value: project.name, 'aria-label': 'Name des Projekts', spellcheck: false });
        name.addEventListener('change', () => {
            const v = name.value.trim();
            if (!v) { name.value = project.name; return; }
            project.name = v;
            save();
            renderSelects();
            if (S.state.get().project?.id === project.id) S.state.setProject(project);
        });
        const rows = project.people.map((person, i) => personRow(project, person, i));
        const addName = el('input', { class: 'input', placeholder: 'Name', 'aria-label': 'Name der Person', autocomplete: 'off' });
        const addRole = el('input', { class: 'input', placeholder: 'Rolle oder Firma (optional)', 'aria-label': 'Rolle oder Firma', autocomplete: 'off' });
        const add = () => {
            const n = addName.value.trim();
            if (!n) return addName.focus();
            if (project.people.some(p => p.name.toLocaleLowerCase('de') === n.toLocaleLowerCase('de'))) {
                S.ui.setStatus(`„${n}“ steht schon in diesem Projekt.`, 'note');
                return;
            }
            project.people.push({ name: n, role: addRole.value.trim() });
            save();
            render();
            $(`project-${project.id}`)?.querySelector('.person-add input')?.focus();
        };
        [addName, addRole].forEach(input => input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }));

        return el('section', { class: 'card project-card' + (isCurrent ? ' is-current' : ''), id: `project-${project.id}` },
            el('div', { class: 'project-head' },
                name,
                isCurrent
                    ? el('span', { class: 'tag', text: 'Aktuelles Projekt' })
                    : el('button', { type: 'button', class: 'btn-text', text: 'Als aktuelles Projekt verwenden', onclick: () => setCurrent(project.id) }),
                el('button', { type: 'button', class: 'btn-text is-danger', text: 'Löschen', onclick: () => removeProject(project) })),
            el('p', { class: 't-small muted', text: project.people.length
                ? `${project.people.length} Person${project.people.length === 1 ? '' : 'en'}`
                : 'Noch keine Personen. Namen werden der Spracherkennung als Fachbegriffe mitgegeben.' }),
            rows.length ? el('ul', { class: 'person-list' }, ...rows) : null,
            el('div', { class: 'person-add' }, addName, addRole,
                el('button', { type: 'button', class: 'btn-secondary is-small', text: 'Hinzufügen', onclick: add })));
    }

    function personRow(project, person, index) {
        const name = el('input', { class: 'input', value: person.name, 'aria-label': 'Name', spellcheck: false });
        const role = el('input', { class: 'input', value: person.role, placeholder: 'Rolle oder Firma', 'aria-label': 'Rolle oder Firma' });
        name.addEventListener('change', () => { if (name.value.trim()) { person.name = name.value.trim(); save(); renderDatalist(); } else name.value = person.name; });
        role.addEventListener('change', () => { person.role = role.value.trim(); save(); renderDatalist(); });
        return el('li', { class: 'person-row' }, name, role,
            el('button', { type: 'button', class: 'icon-btn is-small', 'aria-label': `${person.name} entfernen`, title: 'Entfernen',
                onclick: () => { project.people.splice(index, 1); save(); render(); } }, S.icon('close')));
    }

    function addProject() {
        const input = $('project-new-name');
        const name = input.value.trim();
        if (!name) return input.focus();
        const project = { id: newId(), name, people: [] };
        projects.push(project);
        if (!currentId) currentId = project.id;
        input.value = '';
        save();
        render();
        $(`project-${project.id}`)?.querySelector('.person-add input')?.focus();
    }

    function removeProject(project) {
        if (!confirm(`Projekt „${project.name}“ mit ${project.people.length} Person(en) löschen? Transkripte bleiben erhalten.`)) return;
        projects = projects.filter(p => p !== project);
        if (currentId === project.id) currentId = '';
        save();
        render();
    }

    function clearAll() {
        projects = [];
        currentId = '';
        save();
        render();
    }

    function init() {
        load();
        $('project-add')?.addEventListener('click', addProject);
        $('project-new-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addProject(); } });
        $('project-select-start')?.addEventListener('change', e => setCurrent(e.target.value));
        $('transcript-project')?.addEventListener('change', e => {
            const p = get(e.target.value);
            S.state.setProject(p ? { id: p.id, name: p.name } : null);
        });
        S.state.subscribe(type => { if (type === 'reset' || type === 'project') { renderSelects(); renderDatalist(); } });
        render();
    }

    S.people = {
        init, onChange: fn => listeners.add(fn), list: () => projects, get, current, currentId: () => currentId,
        activeProject, people, vocabularyNames, setCurrent, clearAll,
        count: () => ({ projects: projects.length, people: projects.reduce((n, p) => n + p.people.length, 0) })
    };
})(window.Unisono);

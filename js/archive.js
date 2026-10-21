/*
 * Archive of transcripts and the queue "jetzt aufnehmen, später transkribieren".
 *
 * Archive: every transcript (new, opened from a project file or reopened from here) is kept in
 * IndexedDB and saved again while it is edited. The page "Archiv" lists them with search and key
 * figures; opening one replaces the open transcript like opening a project file.
 *
 * Queue: a file that cannot be sent now (offline, or the upload failed for lack of a connection)
 * is stored with its settings and transcribed in the background as soon as the browser is online
 * again. The result goes into the archive, together with the audio, because a recording made
 * offline exists nowhere else.
 *
 * Everything fails quietly when IndexedDB is unavailable (private mode): then the page says so.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const core = S.archiveCore;
    const DB_NAME = 'unisono-archive';
    const CURRENT_KEY = 'unisono_archive_current';
    const SAVE_DELAY_MS = 1200;
    const $ = id => document.getElementById(id);

    let dbPromise = null;
    let available = true;
    let currentId = null;
    let saveTimer = null;
    let entries = [];
    let pending = [];
    let query = '';
    let processing = false;

    function el(tag, props = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v == null || v === false) continue;
            if (k === 'text') node.textContent = v;
            else if (k === 'class') node.className = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? '' : v);
        }
        node.append(...children.filter(c => c != null));
        return node;
    }

    // --- IndexedDB ---------------------------------------------------------------------------------
    function open() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                if (!window.indexedDB) return reject(new Error('IndexedDB nicht verfügbar'));
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => {
                    req.result.createObjectStore('transcripts', { keyPath: 'id' });
                    req.result.createObjectStore('audio');
                    req.result.createObjectStore('pending', { keyPath: 'id' });
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            }).catch(err => { available = false; throw err; });
        }
        return dbPromise;
    }

    async function run(storeName, mode, fn) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const t = db.transaction(storeName, mode);
            const store = t.objectStore(storeName);
            let result;
            const req = fn(store);
            if (req) req.onsuccess = () => { result = req.result; };
            t.oncomplete = () => resolve(result);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
        });
    }

    const getAll = store => run(store, 'readonly', s => s.getAll()).then(r => r || []);
    const put = (store, value, key) => run(store, 'readwrite', s => key === undefined ? s.put(value) : s.put(value, key));
    const remove = (store, key) => run(store, 'readwrite', s => s.delete(key));
    const getOne = (store, key) => run(store, 'readonly', s => s.get(key));
    const newId = () => 'ar-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    // --- The open transcript ------------------------------------------------------------------------
    // A transcript that is new to the archive (fresh transcription or opened project file).
    function startNew() {
        currentId = newId();
        rememberCurrent();
        saveSoon(0);
    }

    function rememberCurrent() {
        try {
            if (currentId) localStorage.setItem(CURRENT_KEY, currentId);
            else localStorage.removeItem(CURRENT_KEY);
        } catch (_) {}
    }

    function saveSoon(delay = SAVE_DELAY_MS) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveCurrent, delay);
    }

    async function saveCurrent() {
        saveTimer = null;
        if (!currentId || !S.state.get().segments.length) return;
        try {
            const data = JSON.parse(S.export.toJson());
            const previous = entries.find(e => e.id === currentId);
            const entry = core.entryFromProject(data, { id: currentId, hasAudio: !!previous?.hasAudio });
            if (previous) entry.createdAt = previous.createdAt;
            await put('transcripts', entry);
            upsert(entry);
            render();
        } catch (_) { /* storage full or unavailable: editing goes on */ }
    }

    function upsert(entry) {
        const i = entries.findIndex(e => e.id === entry.id);
        if (i >= 0) entries[i] = entry; else entries.push(entry);
    }

    async function openEntry(id) {
        const entry = entries.find(e => e.id === id);
        if (!entry) return;
        if (S.state.get().segments.length && currentId !== id
            && !confirm('Das geöffnete Transkript wird ersetzt. Es bleibt im Archiv. Fortfahren?')) return;
        await flush();
        S.state.loadProject(entry.data);
        S.summary.setText(entry.data.summary);
        currentId = id;
        rememberCurrent();
        if (entry.hasAudio) {
            const audio = await getOne('audio', id).catch(() => null);
            if (audio) S.app.loadFile?.(new File([audio.blob], audio.name || entry.fileName || 'aufnahme', { type: audio.type || audio.blob.type }));
        }
        S.app.switchView('transcript');
        S.ui.setStatus(`„${entry.title}“ aus dem Archiv geöffnet.${entry.hasAudio ? '' : ' Für den Player die Audiodatei laden.'}`, 'success');
    }

    async function deleteEntry(id) {
        const entry = entries.find(e => e.id === id);
        if (!entry || !confirm(`„${entry.title}“ aus dem Archiv löschen?`)) return;
        await remove('transcripts', id).catch(() => {});
        await remove('audio', id).catch(() => {});
        entries = entries.filter(e => e.id !== id);
        if (currentId === id) { currentId = null; rememberCurrent(); }
        render();
    }

    async function clearAll() {
        if (!entries.length || !confirm('Das ganze Archiv in diesem Browser löschen? Das geöffnete Transkript bleibt offen.')) return;
        for (const e of entries) {
            await remove('transcripts', e.id).catch(() => {});
            await remove('audio', e.id).catch(() => {});
        }
        entries = [];
        currentId = null;
        rememberCurrent();
        render();
        S.settings?.refresh();
    }

    async function flush() {
        if (saveTimer) { clearTimeout(saveTimer); await saveCurrent(); }
    }

    // --- Queue: transcribe later --------------------------------------------------------------------
    // Keeps the file and the chosen settings until the browser is online again.
    async function enqueue(file, settings) {
        const item = {
            id: newId(),
            name: file.name,
            type: file.type,
            blob: file,
            markers: file.unisonoMarkers || [],
            addedAt: new Date().toISOString(),
            error: null,
            ...settings
        };
        await put('pending', item);
        pending.push(item);
        render();
        if (navigator.onLine) processQueue();
        return item;
    }

    async function removePending(id) {
        await remove('pending', id).catch(() => {});
        pending = pending.filter(p => p.id !== id);
        render();
    }

    async function processQueue() {
        if (processing || !navigator.onLine || !pending.length) return;
        processing = true;
        render();
        try {
            for (const item of [...pending]) {
                if (!navigator.onLine) break;
                ({ id: item.provider, model: item.model } = S.upgradeEngine(item.provider, item.model));
                const api = S.apis[item.provider];
                if (!api || !S.ui.hasKey(item.provider)) {
                    item.error = api ? `Für ${api.label} fehlt der API-Key.` : 'Die Engine gibt es nicht mehr.';
                    await put('pending', item).catch(() => {});
                    continue;
                }
                item.error = null;
                item.busy = true;
                render();
                try {
                    const file = new File([item.blob], item.name, { type: item.type || item.blob.type });
                    const support = api.vocabularySupport?.(item.model);
                    const vocabulary = support ? S.vocabulary.prepare(S.vocabulary.transcriptionTerms(), support).terms : [];
                    const diarize = !!item.diarize && S.canDiarize(item.provider, item.model);
                    const { raw, segments } = await api.transcribe(file, {
                        key: S.ui.getKey(item.provider), model: item.model, language: item.language,
                        diarize, speakers: diarize ? item.speakers : null, vocabulary,
                        signal: undefined, onStage: () => {}, onUpload: () => {}
                    });
                    const data = core.projectFromResult({ raw, segments, provider: item.provider, fileName: item.name, markers: item.markers });
                    const entry = core.entryFromProject(data, { id: newId(), hasAudio: true });
                    await put('audio', { blob: item.blob, name: item.name, type: item.type }, entry.id);
                    await put('transcripts', entry);
                    upsert(entry);
                    await removePending(item.id);
                    S.ui.setStatus(`„${entry.title}“ wurde nachträglich transkribiert und liegt im Archiv.`, 'success');
                } catch (err) {
                    item.busy = false;
                    if (core.isNetworkError(err)) { item.error = null; break; }     // still no connection: try again later
                    item.error = err?.message || String(err);
                    await put('pending', { ...item, busy: false }).catch(() => {});
                }
            }
        } finally {
            processing = false;
            pending.forEach(p => { p.busy = false; });
            render();
        }
    }

    // --- Page ---------------------------------------------------------------------------------------
    const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const hours = seconds => seconds >= 3600
        ? (seconds / 3600).toFixed(1).replace('.', ',') + ' h'
        : seconds > 0 && seconds < 60 ? '< 1 min' : Math.round(seconds / 60) + ' min';
    const providerName = id => S.apis[id]?.label.split(' (')[0] || (id === 'unbekannt' ? 'Unbekannt' : id);

    function render() {
        if (!$('archive-list')) return;
        $('archive-unavailable').classList.toggle('hidden', available);
        renderStats();
        renderPending();
        const list = entries.filter(e => core.matches(e, query)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        $('archive-count').textContent = entries.length
            ? (query ? `${list.length} von ${entries.length}` : `${entries.length} Transkript${entries.length === 1 ? '' : 'e'}`)
            : '';
        $('archive-empty').classList.toggle('hidden', list.length > 0);
        $('archive-empty').textContent = entries.length
            ? 'Keine Treffer.'
            : 'Noch nichts im Archiv. Jedes Transkript landet hier automatisch und wird beim Bearbeiten mitgespeichert.';
        $('archive-list').replaceChildren(...list.map(rowFor));
        $('archive-clear').disabled = !entries.length;
    }

    function rowFor(e) {
        const meta = [
            e.project || null,
            dateFmt.format(new Date(e.createdAt)),
            e.seconds ? S.format.clock(e.seconds) : null,
            e.speakers ? `${e.speakers} Sprecher` : null,
            `${e.words.toLocaleString('de-DE')} Wörter`,
            e.provider ? providerName(e.provider) : null,
            e.hasAudio ? 'mit Audio' : null,
            e.openTasks ? `${e.openTasks} offene Aufgabe${e.openTasks === 1 ? '' : 'n'}` : null
        ].filter(Boolean).join(' · ');
        return el('li', { class: 'archive-row' + (e.id === currentId ? ' is-current' : '') },
            el('button', { type: 'button', class: 'archive-open', onclick: () => openEntry(e.id) },
                el('span', { class: 'archive-title', text: e.title }),
                el('span', { class: 't-small muted', text: meta }),
                e.preview ? el('span', { class: 't-small archive-preview', text: e.preview }) : null),
            el('button', { type: 'button', class: 'icon-btn', 'aria-label': `„${e.title}“ löschen`, title: 'Löschen', onclick: () => deleteEntry(e.id) }, S.icon('trash')));
    }

    function renderStats() {
        const st = core.stats(entries);
        const tile = (label, value, extra) => el('div', { class: 'stat-card' },
            el('span', { class: 't-label muted', text: label }),
            el('span', { class: 'stat-value' }, value, extra ? el('span', { class: 't-small muted stat-extra', text: extra }) : null));
        $('archive-stats').replaceChildren(
            el('div', { class: 'stat-grid' },
                tile('Transkripte', String(st.count)),
                tile('Audio gesamt', hours(st.seconds)),
                tile('Wörter', st.words.toLocaleString('de-DE')),
                tile('Diesen Monat', String(st.monthCount), st.monthCount ? hours(st.monthSeconds) : null)),
            st.byProvider.length
                ? el('p', { class: 't-small muted', text: 'Nach Engine: ' + st.byProvider.map(p => `${providerName(p.id)} ${p.count}× (${hours(p.seconds)})`).join(' · ') })
                : null);
    }

    function renderPending() {
        $('archive-pending-card').classList.toggle('hidden', !pending.length);
        if (!pending.length) return;
        $('archive-pending-note').textContent = navigator.onLine
            ? (processing ? 'Wird gerade transkribiert …' : 'Online. Einträge mit Fehler bitte prüfen oder erneut starten.')
            : 'Offline. Sobald wieder eine Verbindung besteht, wird automatisch transkribiert.';
        $('archive-pending').replaceChildren(...pending.map(p => el('li', { class: 'archive-row' },
            el('div', { class: 'archive-open' },
                el('span', { class: 'archive-title', text: p.name }),
                el('span', { class: 't-small muted', text: [dateFmt.format(new Date(p.addedAt)), S.apis[p.provider]?.label.split(' (')[0], (p.blob.size / 1048576).toFixed(1).replace('.', ',') + ' MB'].filter(Boolean).join(' · ') }),
                p.busy ? el('span', { class: 't-small', text: 'Wird transkribiert …' }) : null,
                p.error ? el('span', { class: 't-small archive-error', text: p.error }) : null),
            el('button', { type: 'button', class: 'icon-btn', 'aria-label': `„${p.name}“ aus der Warteschlange entfernen`, title: 'Entfernen', disabled: p.busy || undefined, onclick: () => {
                if (confirm(`„${p.name}“ aus der Warteschlange entfernen? Die Aufnahme wird dabei gelöscht.`)) removePending(p.id);
            } }, S.icon('trash')))));
        $('archive-retry').disabled = processing || !navigator.onLine;
    }

    // --- Setup ---------------------------------------------------------------------------------------
    async function init() {
        try { currentId = localStorage.getItem(CURRENT_KEY); } catch (_) {}
        $('archive-search').addEventListener('input', e => { query = e.target.value; render(); });
        $('archive-clear').addEventListener('click', clearAll);
        $('archive-retry').addEventListener('click', () => { pending.forEach(p => { p.error = null; }); processQueue(); });
        $('summary-text')?.addEventListener('input', () => { if (currentId) saveSoon(); });
        S.state.subscribe(type => {
            if (type === 'reset' && !S.state.get().segments.length) { currentId = null; rememberCurrent(); return; }
            if (currentId) saveSoon();
        });
        window.addEventListener('online', () => { render(); processQueue(); });
        window.addEventListener('offline', render);
        window.addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); saveCurrent(); } });
        try {
            entries = await getAll('transcripts');
            pending = (await getAll('pending')).map(p => ({ ...p, busy: false }));
        } catch (_) { available = false; }
        // A transcript restored after a reload that the archive does not know yet (older version).
        if (S.state.get().segments.length && (!currentId || !entries.some(e => e.id === currentId))) startNew();
        // The last edit before closing the tab may not have reached the archive: the restored state is newer.
        else if (currentId && S.state.get().segments.length) saveSoon(0);
        render();
        S.settings?.refresh();
        processQueue();
    }

    S.archive = {
        init, startNew, enqueue, processQueue,
        isAvailable: () => available,
        count: () => entries.length,
        pendingCount: () => pending.length,
        clearAll
    };
})(window.Unisono);

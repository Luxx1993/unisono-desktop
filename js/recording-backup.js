/*
 * Crash-safe backup of a running recording in IndexedDB.
 *
 * The recorder hands over a chunk every second. If the tab is closed, reloaded or killed
 * by the phone mid-recording, the chunks survive and the recording can be restored on the
 * next visit. After a normal stop the backup is removed.
 *
 * Every call fails silently (private mode, storage full): the recording itself still works,
 * only the safety net is missing – isAvailable() tells the UI.
 */
window.Unisono = window.Unisono || {};
(function (S) {
    const DB_NAME = 'unisono-recordings';
    const META_KEY = 'current';
    let dbPromise = null;
    let available = true;

    function open() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                if (!window.indexedDB) return reject(new Error('IndexedDB nicht verfügbar'));
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => {
                    req.result.createObjectStore('meta');
                    req.result.createObjectStore('chunks', { autoIncrement: true });
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            }).catch(err => { available = false; throw err; });
        }
        return dbPromise;
    }

    // Runs fn(stores) in one transaction and resolves when it has been committed.
    async function tx(mode, fn) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const t = db.transaction(['meta', 'chunks'], mode);
            let result;
            Promise.resolve(fn({ meta: t.objectStore('meta'), chunks: t.objectStore('chunks') }))
                .then(r => { result = r; })
                .catch(reject);
            t.oncomplete = () => resolve(result);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
        });
    }

    function request(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function quiet(promise) {
        return promise.catch(() => { available = false; });
    }

    // Starts a new backup, replacing any previous one.
    function begin({ mime, startedAt }) {
        return quiet(tx('readwrite', ({ meta, chunks }) => {
            chunks.clear();
            meta.put({ mime, startedAt, elapsedMs: 0 }, META_KEY);
        }));
    }

    function addChunk(blob) {
        return quiet(tx('readwrite', ({ chunks }) => { chunks.add(blob); }));
    }

    // changes: { elapsedMs?, markers? } – merged into the stored info of the running recording.
    function updateMeta(changes) {
        return quiet(tx('readwrite', async ({ meta }) => {
            const current = await request(meta.get(META_KEY));
            if (current) meta.put({ ...current, ...changes }, META_KEY);
        }));
    }

    function clear() {
        return quiet(tx('readwrite', ({ meta, chunks }) => {
            meta.delete(META_KEY);
            chunks.clear();
        }));
    }

    // → { mime, startedAt, elapsedMs, markers, blob } of an unfinished recording, or null.
    async function find() {
        try {
            return await tx('readonly', async ({ meta, chunks }) => {
                const info = await request(meta.get(META_KEY));
                if (!info) return null;
                const parts = await request(chunks.getAll());
                if (!parts.length) return null;
                const blob = new Blob(parts, { type: (info.mime || 'audio/webm').split(';')[0] });
                return { ...info, blob };
            });
        } catch (_) {
            available = false;
            return null;
        }
    }

    S.recordingBackup = { begin, addChunk, updateMeta, clear, find, isAvailable: () => available };
})(window.Unisono);

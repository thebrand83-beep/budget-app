// Data layer with two interchangeable backends:
//  - CloudStore: Supabase (Auth + Postgres with RLS + private Storage, signed URLs)
//  - LocalStore: IndexedDB in this browser (preview mode, no account needed)
import { CONFIG } from './config.js';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
export { uuid };
const TX_FIELDS = ['id', 'kind', 'amount', 'date', 'category_id', 'scope', 'title', 'notes', 'payment_method', 'receipt_path', 'receipt_name', 'receipt_type', 'recurring_id'];
const REC_FIELDS = ['id', 'kind', 'amount', 'category_id', 'scope', 'title', 'notes', 'day_of_month', 'start_month', 'end_month', 'active', 'skip_months'];
const CAT_FIELDS = ['id', 'name', 'kind', 'color', 'icon', 'monthly_budget', 'sort', 'archived'];
const pick = (o, f) => Object.fromEntries(f.filter(k => k in o).map(k => [k, o[k] === '' ? null : o[k]]));
const safeName = n => (n || 'receipt').normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80) || 'receipt';

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('טעינת ספרייה נכשלה')); document.head.appendChild(s); });
}

// ----------------------------------------------------------------------------- network helpers
// Every request gets a hard deadline that ABORTS it (a stalled socket after sleep / network change otherwise
// hangs forever and blocks the auth client behind it). Transient failures are retried with backoff; all writes
// are idempotent (client-generated UUIDs + upsert), so a retry can never create a duplicate.
const NET_TIMEOUT_MS = 15000;     // one REST/auth attempt (server answers in ~0.3-1s; this is only a safety net)
const MAX_UPLOAD_MB = 25;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = n => Math.min(60000, 1000 * 2 ** n) * (0.75 + Math.random() * 0.5);
const tag = (e, code, extra) => Object.assign(e instanceof Error ? e : new Error(String(e?.message || e || code)), { code }, extra || {});
function withTimeout(p, ms) {
  let tm; const t = new Promise((_, rej) => { tm = setTimeout(() => rej(tag(new Error('TIMEOUT'), 'TIMEOUT')), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(tm));
}
function timedFetch(input, init = {}) {
  const ctl = new AbortController(), outer = init.signal, url = typeof input === 'string' ? input : input?.url || '';
  const ms = /\/storage\/v1\/object\//.test(url) ? 90000 : NET_TIMEOUT_MS; // receipt downloads can be big
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', () => ctl.abort(), { once: true }); }
  const tm = setTimeout(() => ctl.abort(), ms);
  return fetch(input, { ...init, signal: ctl.signal })
    .catch(e => { throw (e?.name === 'AbortError' && !outer?.aborted) ? new TypeError('NETWORK_TIMEOUT: no answer in ' + ms / 1000 + 's') : e; })
    .finally(() => clearTimeout(tm));
}
const isAuthErr = e => e?.status === 401 || /JWT|token is expired|invalid claim|PGRST30[13]/i.test(String(e?.message || '') + ' ' + (e?.code || ''));
// network trouble or a server hiccup: safe to try again later
const isTransient = e => !e || e.code === 'TIMEOUT' || e.code === 'OFFLINE' || e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500 ||
  /NETWORK_TIMEOUT|Failed to fetch|Load failed|NetworkError|network connection|fetch failed|TypeError|AbortError|ECONN|ETIMEDOUT|upstream|timeout/i.test(String(e?.message || ''));
// run a supabase-js builder and turn {error,status} into a thrown error that carries the HTTP status
async function q(builder) {
  const r = await builder;
  if (r.error) throw Object.assign(new Error(r.error.message || 'error'), { code: r.error.code || r.error.statusCode, status: r.status ?? +r.error.statusCode ?? 0, details: r.error.details });
  return r.data;
}
// tiny IndexedDB key/value helper
function idb(name, stores) {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { for (const [s, opt] of Object.entries(stores)) r.result.createObjectStore(s, opt); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const run = async (store, mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  const lim = p => withTimeout(p, 8000); // device storage must never block a save
  return { get: (s, k) => lim(run(s, 'readonly', st => st.get(k))), all: (s) => lim(run(s, 'readonly', st => st.getAll())), put: (s, v) => lim(run(s, 'readwrite', st => st.put(v))), del: (s, k) => k < 0 ? Promise.resolve() : lim(run(s, 'readwrite', st => st.delete(k))) };
}
const TABLE_FIELDS = { budget_transactions: TX_FIELDS, budget_recurring: REC_FIELDS, budget_categories: CAT_FIELDS };
const SNAP_KEY = { budget_transactions: 'txs', budget_recurring: 'recurring', budget_categories: 'cats' };

// ----------------------------------------------------------------------------- Cloud
class CloudStore {
  mode = 'cloud';
  offline = false;                 // last read came from the on-device copy
  _ops = [];                       // outbox mirror (ordered by seq)
  _listeners = new Set();
  _status = { state: 'idle', pending: 0, upload: null, error: null };
  async init() {
    if (!window.supabase) await loadScript(CONFIG.supabaseJs);
    this.sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'budget.auth' },
      global: { fetch: timedFetch },
    });
    this.db = idb('budget-sync', { outbox: { keyPath: 'seq', autoIncrement: true }, snap: { keyPath: 'k' } });
    let session = null, err = null;
    try { ({ data: { session }, error: err } = await withTimeout(this.sb.auth.getSession(), 20000)); } catch (e) { err = e; }
    this.user = session?.user || null;
    // offline with an expired access token: keep the stored sign-in, work from the device copy, sync later
    if (!this.user && err && isTransient(err)) {
      try { this.user = JSON.parse(localStorage.getItem('budget.auth') || 'null')?.user || null; } catch { }
      if (this.user) this.offline = true;
    }
    if (this.user) await this._loadOps();
    this._wire();
    return this.user;
  }
  onAuth(cb) { this.sb.auth.onAuthStateChange((ev, s) => { if (s?.user) this.user = s.user; else if (ev === 'SIGNED_OUT') this.user = null; if (this.user && ev === 'SIGNED_IN') this._loadOps().then(() => this.flush()); cb(ev, this.user); }); }
  async signIn(email, password) { const data = await q(this.sb.auth.signInWithPassword({ email, password })); this.user = data.user; await this._loadOps(); this.flush(); return data.user; }
  async signUp(email, password) { const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0].split('?')[0] } }); if (error) throw error; return data; }
  async magicLink(email) { const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.href.split('#')[0] } }); if (error) throw error; }
  async resetPassword(email) { const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] }); if (error) throw error; }
  async setPassword(password) { const { error } = await this.sb.auth.updateUser({ password }); if (error) throw error; }
  async signOut() {
    const uid = this.user?.id;
    for (const o of this._ops) await this.db.del('outbox', o.seq).catch(() => {});
    if (uid) await this.db.del('snap', uid).catch(() => {});
    this._ops = []; this._emit();
    await this.sb.auth.signOut({ scope: 'local' }).catch(() => {}); this.user = null;
  }
  // open the connection early (DNS + TLS) so the first real save doesn't pay for it
  warm() { return timedFetch(CONFIG.supabaseUrl + '/auth/v1/health', { headers: { apikey: CONFIG.supabaseAnonKey }, cache: 'no-store' }).then(r => { if (r.ok) { this._setOnline(); } return r.ok; }).catch(() => false); }

  // ---- direct calls (reads + idempotent bulk writes): retry transient failures, refresh an expired session once
  async _run(fn, { tries = 3, ms = NET_TIMEOUT_MS + 5000 } = {}) {
    let refreshed = false;
    for (let i = 0; ; i++) {
      try { const r = await withTimeout(fn(), ms); this._setOnline(); return r; }
      catch (e) {
        if (isAuthErr(e) && !refreshed) {
          refreshed = true;
          const { error } = await withTimeout(this.sb.auth.refreshSession(), NET_TIMEOUT_MS + 5000).catch(x => ({ error: x }));
          if (error && !isTransient(error)) throw tag(new Error('SESSION_EXPIRED'), 'SESSION_EXPIRED');
          if (!error) continue;
          e = error;
        }
        if (!isTransient(e) || i >= tries - 1) throw e;
        await sleep(backoff(i));
      }
    }
  }
  async _all(table, order) {
    const out = []; const step = 1000;
    for (let from = 0; ; from += step) {
      const data = await this._run(() => { let b = this.sb.from(table).select('*').range(from, from + step - 1); for (const [c, asc] of order) b = b.order(c, { ascending: asc }); return q(b); });
      out.push(...data); if (data.length < step) break;
    }
    return out;
  }
  /** Everything for the app in one go. Falls back to the on-device copy when the network is down. Pending (not yet
   *  synced) changes are always laid over the result, so nothing the user entered disappears on reload. */
  async loadAll() {
    let snap;
    try {
      const [cats, txs, recurring, settings] = await Promise.all([
        this._all('budget_categories', [['sort', true], ['name', true]]), this._all('budget_transactions', [['date', false], ['created_at', false]]),
        this._all('budget_recurring', [['created_at', true]]), this._run(() => q(this.sb.from('budget_settings').select('data').maybeSingle())).then(d => d?.data || {})]);
      snap = { k: this.user.id, cats, txs, recurring, settings, at: Date.now() };
      this.offline = false; this.db.put('snap', snap).catch(() => {});
    } catch (e) {
      if (!isTransient(e)) throw e;
      snap = await this.db.get('snap', this.user.id).catch(() => null);
      if (!snap) throw e;
      this.offline = true; this._set({ state: 'offline' });
    }
    const out = { cats: snap.cats, txs: snap.txs, recurring: snap.recurring, settings: snap.settings };
    for (const o of this._ops) this._apply(out, o);
    out.txs.sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''));
    return out;
  }
  listCategories() { return this._all('budget_categories', [['sort', true], ['name', true]]); }
  listTransactions() { return this._all('budget_transactions', [['date', false], ['created_at', false]]).then(l => { const o = { txs: l }; for (const op of this._ops) this._apply(o, op); return o.txs; }).catch(async e => { if (!isTransient(e)) throw e; return (await this.loadAll()).txs; }); }
  listRecurring() { return this._all('budget_recurring', [['created_at', true]]); }
  async getSettings() { return this._run(() => q(this.sb.from('budget_settings').select('data').maybeSingle())).then(d => d?.data || {}); }
  async insertCategories(list) { return this._run(() => q(this.sb.from('budget_categories').upsert(list.map(c => pick(c, CAT_FIELDS)), { onConflict: 'user_id,kind,name', ignoreDuplicates: true }).select())); }

  // ---- writes: saved on the device first (outbox), shown at once, sent in order in the background
  saveTransaction(t) { return this._enqueue({ kind: 'upsert', table: 'budget_transactions', row: { ...pick(t, TX_FIELDS), created_at: t.created_at || new Date().toISOString(), amount: +t.amount } }); }
  saveRecurring(r) { return this._enqueue({ kind: 'upsert', table: 'budget_recurring', row: { active: true, skip_months: [], ...pick(r, REC_FIELDS), created_at: r.created_at || new Date().toISOString(), amount: +r.amount } }); }
  saveCategory(c) { return this._enqueue({ kind: 'upsert', table: 'budget_categories', row: { archived: false, sort: 0, ...pick(c, CAT_FIELDS) } }); }
  saveSettings(s) { return this._enqueue({ kind: 'settings', data: s }); }
  deleteCategory(id) { return this._enqueue({ kind: 'delete', table: 'budget_categories', id }); }
  deleteRecurring(id) { return this._enqueue({ kind: 'delete', table: 'budget_recurring', id }); }
  async deleteTransaction(t) { await this._enqueue({ kind: 'delete', table: 'budget_transactions', id: t.id }); if (t.receipt_path) await this.deleteReceipt(t.receipt_path); } // row first: the receipt goes only after it
  /** Recurring occurrences: unique per (rule, date) in the DB, so a duplicate from another device is simply ignored. */
  async insertGenerated(list) { if (!list.length) return []; await this._enqueue({ kind: 'gen', rows: list.map(t => ({ ...pick(t, TX_FIELDS), created_at: new Date().toISOString() })) }); return list; }
  async uploadReceipt(txId, file) {
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw tag(new Error('FILE_TOO_BIG'), 'FILE_TOO_BIG');
    const path = `${this.user.id}/${txId}/${Date.now()}_${safeName(file.name)}`; // fixed per upload, so a retry overwrites, never duplicates
    await this._enqueue({ kind: 'upload', path, blob: file, type: file.type || 'application/octet-stream', size: file.size });
    return { receipt_path: path, receipt_name: file.name || 'receipt', receipt_type: file.type || '' };
  }
  async deleteReceipt(path) {
    const up = this._ops.find(o => o.kind === 'upload' && o.path === path);
    if (up && !up.started) { await this.db.del('outbox', up.seq).catch(() => {}); this._ops = this._ops.filter(o => o !== up); this._emit(); return; } // never left the device
    return this._enqueue({ kind: 'rmfile', path });
  }
  _pendingBlob(path) { return this._ops.find(o => o.kind === 'upload' && o.path === path)?.blob; }
  async receiptUrl(path, download) {
    const b = this._pendingBlob(path); if (b) return URL.createObjectURL(b);
    return this._run(() => q(this.sb.storage.from(CONFIG.receiptsBucket).createSignedUrl(path, CONFIG.signedUrlSeconds, download ? { download: true } : undefined))).then(d => d.signedUrl);
  }
  async receiptBlob(path) { const b = this._pendingBlob(path); if (b) return b; return this._run(() => q(this.sb.storage.from(CONFIG.receiptsBucket).download(path)), { ms: 95000 }); }

  // ---- sync status for the UI
  isPending(id) { return this._ops.some(o => (o.kind === 'upsert' && o.row.id === id) || (o.kind === 'gen' && o.rows.some(r => r.id === id))); }
  get status() { return { ...this._status, pending: this._ops.length, changes: this._ops.filter(o => o.kind !== 'upload' && o.kind !== 'rmfile').length || (this._ops.length ? 1 : 0), offline: this.offline }; }
  onStatus(cb) { this._listeners.add(cb); cb(this.status); return () => this._listeners.delete(cb); }
  onFailed(cb) { this._onFailed = cb; }
  _emit() { const s = this.status; for (const cb of this._listeners) try { cb(s); } catch { } }
  _set(p) { Object.assign(this._status, p); this._emit(); }
  _setOnline() { if (this.offline || this._status.state === 'offline') { this.offline = false; this._set({ state: this._ops.length ? 'syncing' : 'idle' }); this.flush(); } }

  // ---- outbox
  async _loadOps() {
    const all = await this.db.all('outbox').catch(() => []), mem = this._ops.filter(o => o.seq < 0 && o.uid === this.user?.id);
    const have = new Map(this._ops.map(o => [o.seq, o])); // keep the live objects (one may be in flight)
    this._ops = all.filter(o => o.uid === this.user?.id).map(o => have.get(o.seq) || (o.kind === 'upload' && o.buf && !o.blob ? { ...o, blob: new Blob([o.buf], { type: o.type }) } : o)).sort((a, b) => a.seq - b.seq).concat(mem);
    this._emit();
  }
  // receipts are kept as an ArrayBuffer on the device: every engine can store that (Blobs fail in some Safari modes)
  async _persist(op) {
    const { blob, started, ...rest } = op;
    try { return await this.db.put('outbox', blob ? { ...rest, buf: await blob.arrayBuffer() } : rest); }
    catch (e) { console.warn('outbox: device storage unavailable, keeping the change in memory', e); return op.seq > 0 ? op.seq : -(++this._memSeq); }
  }
  _memSeq = 0;
  async _enqueue(op) {
    op = { ...op, uid: this.user.id, at: Date.now(), tries: 0 };
    // newer settings replace older unsent ones
    if (op.kind === 'settings') for (const o of this._ops.filter(o => o.kind === 'settings' && !o.started)) { await this.db.del('outbox', o.seq).catch(() => {}); this._ops = this._ops.filter(x => x !== o); }
    op.seq = await this._persist(op);
    this._ops.push(op); this._emit();
    this.flush();
    return op.row || op.rows || op.data;
  }
  _apply(o, op) { // lay one pending change over a {txs,cats,recurring,settings} view
    if (op.kind === 'upsert') { const k = SNAP_KEY[op.table]; if (!o[k]) return; const old = o[k].find(x => x.id === op.row.id); o[k] = [{ ...old, ...op.row }, ...o[k].filter(x => x.id !== op.row.id)]; }
    else if (op.kind === 'delete') { const k = SNAP_KEY[op.table]; if (o[k]) o[k] = o[k].filter(x => x.id !== op.id); }
    else if (op.kind === 'gen' && o.txs) { for (const r of op.rows) if (!o.txs.some(x => x.recurring_id === r.recurring_id && x.date === r.date)) o.txs = [r, ...o.txs]; }
    else if (op.kind === 'settings') o.settings = op.data;
  }
  async _snapApply(op) { const s = await this.db.get('snap', this.user.id).catch(() => null); if (!s) return; this._apply(s, op); await this.db.put('snap', s).catch(() => {}); }
  flush() {
    if (this._flushing) { this._again = true; return this._flushing; }
    clearTimeout(this._timer);
    this._flushing = (async () => {
      do {
        this._again = false;
        while (this._ops.length && this.user) {
          const op = this._ops[0];
          if (op.uid !== this.user.id) { this._ops.shift(); continue; }
          if (op.nextAt > Date.now() && !this._force) { this._timer = setTimeout(() => this.flush(), op.nextAt - Date.now()); break; }
          this._set({ state: 'syncing' });
          try {
            op.started = true;
            await this._send(op);
            await this.db.del('outbox', op.seq).catch(() => {}); this._ops = this._ops.filter(x => x !== op);
            await this._snapApply(op);
            this.offline = false; this._set({ state: this._ops.length ? 'syncing' : 'idle', error: null, upload: null });
          } catch (e) {
            op.started = false;
            if (e?.code === 'SESSION_EXPIRED') { this._set({ state: 'auth', upload: null }); break; }
            if (isTransient(e)) {
              op.tries++; op.nextAt = Date.now() + backoff(Math.min(op.tries - 1, 6)); if (op.seq > 0 && !op.blob) await this.db.put('outbox', (({ started, ...r }) => r)(op)).catch(() => {});
              this.offline = !navigator.onLine || op.tries >= 2;
              this._set({ state: 'offline', upload: null, error: e });
              this._timer = setTimeout(() => this.flush(), op.nextAt - Date.now());
              break;
            }
            // a real rejection (validation, permissions): drop it so it can't block the queue, and tell the app
            await this.db.del('outbox', op.seq).catch(() => {}); this._ops = this._ops.filter(x => x !== op);
            this._set({ state: this._ops.length ? 'syncing' : 'idle', upload: null, error: e });
            try { this._onFailed?.(e, op); } catch { }
          }
        }
      } while (this._again);
      this._force = false;
      if (!this._ops.length && this._status.state !== 'auth') this._set({ state: 'idle', upload: null });
    })().finally(() => { this._flushing = null; });
    return this._flushing;
  }
  /** Retry now (connection is back / user pressed "try again"). */
  syncNow() { this._force = true; for (const o of this._ops) o.nextAt = 0; return this.flush(); }
  async _send(op) {
    if (!navigator.onLine) throw tag(new Error('OFFLINE'), 'OFFLINE');
    const once = fn => this._run(fn, { tries: 1 });
    if (op.kind === 'upsert') {
      const row = pick(op.row, TABLE_FIELDS[op.table]);
      if (op.table === 'budget_categories') {
        try { await once(() => q(this.sb.from(op.table).upsert(row))); }
        catch (e) { if (e.code !== '23505') throw e; } // same name already exists (made on another device): keep theirs
      } else await once(() => q(this.sb.from(op.table).upsert(row)));
    } else if (op.kind === 'delete') {
      await once(() => q(this.sb.from(op.table).delete().eq('id', op.id))); // already gone = fine (idempotent)
    } else if (op.kind === 'gen') {
      await once(() => q(this.sb.from('budget_transactions').upsert(op.rows.map(t => pick(t, TX_FIELDS)), { onConflict: 'user_id,recurring_id,date', ignoreDuplicates: true })));
    } else if (op.kind === 'settings') {
      await once(() => q(this.sb.from('budget_settings').upsert({ user_id: this.user.id, data: op.data, updated_at: new Date().toISOString() })));
    } else if (op.kind === 'rmfile') {
      await once(() => q(this.sb.storage.from(CONFIG.receiptsBucket).remove([op.path])));
    } else if (op.kind === 'upload') {
      await this._uploadXHR(op);
    }
  }
  /** Receipt upload with progress. No fixed deadline: it is aborted only if no bytes move for 30s. */
  async _uploadXHR(op, retried) {
    const { data } = await withTimeout(this.sb.auth.getSession(), NET_TIMEOUT_MS + 5000);
    const token = data.session?.access_token; if (!token) throw tag(new Error('SESSION_EXPIRED'), 'SESSION_EXPIRED');
    const url = `${CONFIG.supabaseUrl}/storage/v1/object/${CONFIG.receiptsBucket}/${op.path.split('/').map(encodeURIComponent).join('/')}`;
    try {
      await new Promise((res, rej) => {
        const x = new XMLHttpRequest(); let last = Date.now();
        const dog = setInterval(() => { if (Date.now() - last > 30000) { x.abort(); } }, 2000);
        const done = f => v => { clearInterval(dog); f(v); };
        x.open('POST', url);
        x.setRequestHeader('authorization', 'Bearer ' + token); x.setRequestHeader('apikey', CONFIG.supabaseAnonKey);
        x.setRequestHeader('x-upsert', 'true'); x.setRequestHeader('content-type', op.type); x.setRequestHeader('cache-control', 'max-age=3600');
        x.upload.onprogress = e => { last = Date.now(); if (e.lengthComputable) this._set({ upload: { pct: Math.round(e.loaded / e.total * 100), size: e.total } }); };
        x.onload = done(() => { if (x.status >= 200 && x.status < 300) return res(); let m = x.responseText; try { const j = JSON.parse(m); m = j.message || j.error || m; } catch { } rej(Object.assign(new Error(m || 'upload failed'), { status: x.status === 400 && /jwt|token|unauthor/i.test(m) ? 401 : x.status })); });
        x.onerror = done(() => rej(Object.assign(new TypeError('Failed to fetch (upload)'), { status: 0 })));
        x.onabort = done(() => rej(Object.assign(new TypeError('NETWORK_TIMEOUT (upload stalled)'), { status: 0 })));
        this._set({ upload: { pct: 0, size: op.size } });
        x.send(op.blob);
      });
    } catch (e) {
      if (isAuthErr(e) && !retried) { const { error } = await this.sb.auth.refreshSession().catch(x => ({ error: x })); if (!error) return this._uploadXHR(op, true); if (!isTransient(error)) throw tag(new Error('SESSION_EXPIRED'), 'SESSION_EXPIRED'); }
      throw e;
    }
  }
  _wire() {
    if (this._wired) return; this._wired = true;
    addEventListener('online', () => { this.warm(); this.syncNow(); });
    addEventListener('offline', () => { this.offline = true; this._set({ state: 'offline' }); });
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (Date.now() - hiddenAt > 30000) this.warm(); // after sleep / a long break the old connection may be dead
      if (this._ops.length) this.syncNow();
    });
    setInterval(() => { if (this._ops.length && !this._flushing) this.flush(); }, 30000);
  }
}

// ----------------------------------------------------------------------------- Local (IndexedDB)
class LocalStore {
  mode = 'local';
  user = { id: 'local', email: 'תצוגה מקדימה' };
  async init() {
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('budget-app', 1);
      r.onupgradeneeded = () => { const d = r.result; for (const s of ['categories', 'transactions', 'recurring', 'kv', 'blobs']) d.createObjectStore(s, { keyPath: s === 'kv' || s === 'blobs' ? 'k' : 'id' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.user;
  }
  onAuth() {}
  _tx(store, mode, fn) { return new Promise((res, rej) => { const t = this.db.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); }
  _getAll(store) { return this._tx(store, 'readonly', s => s.getAll()); }
  async _put(store, row) { await this._tx(store, 'readwrite', s => s.put(row)); return row; }
  async listCategories() { return (await this._getAll('categories')).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)); }
  async listTransactions() { return (await this._getAll('transactions')).sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || '')); }
  async listRecurring() { return this._getAll('recurring'); }
  saveCategory(c) { return this._put('categories', { archived: false, sort: 0, ...pick(c, CAT_FIELDS), id: c.id || uuid() }); }
  saveTransaction(t) { return this._put('transactions', { ...pick(t, TX_FIELDS), id: t.id || uuid(), created_at: t.created_at || new Date().toISOString(), amount: +t.amount }); }
  saveRecurring(r) { return this._put('recurring', { active: true, skip_months: [], ...pick(r, REC_FIELDS), id: r.id || uuid(), created_at: r.created_at || new Date().toISOString(), amount: +r.amount }); }
  async insertCategories(list) { const ex = await this.listCategories(); const out = []; for (const c of list) if (!ex.some(e => e.kind === c.kind && e.name === c.name)) out.push(await this.saveCategory(c)); return out; }
  async insertGenerated(list) { const ex = await this.listTransactions(); const out = []; for (const t of list) if (!ex.some(e => e.recurring_id === t.recurring_id && e.date === t.date)) out.push(await this.saveTransaction(t)); return out; }
  deleteCategory(id) { return this._tx('categories', 'readwrite', s => s.delete(id)); }
  deleteRecurring(id) { return this._tx('recurring', 'readwrite', s => s.delete(id)); }
  async deleteTransaction(t) { await this._tx('transactions', 'readwrite', s => s.delete(t.id)); if (t.receipt_path) await this.deleteReceipt(t.receipt_path); }
  async getSettings() { const r = await this._tx('kv', 'readonly', s => s.get('settings')); return r?.v || {}; }
  saveSettings(v) { return this._tx('kv', 'readwrite', s => s.put({ k: 'settings', v })); }
  async uploadReceipt(txId, file) { const path = `local/${txId}/${Date.now()}_${safeName(file.name)}`; await this._tx('blobs', 'readwrite', s => s.put({ k: path, blob: file })); return { receipt_path: path, receipt_name: file.name || 'receipt', receipt_type: file.type || '' }; }
  async receiptBlob(path) { const r = await this._tx('blobs', 'readonly', s => s.get(path)); if (!r) throw new Error('הקבלה לא נמצאה'); return r.blob; }
  async receiptUrl(path) { return URL.createObjectURL(await this.receiptBlob(path)); }
  deleteReceipt(path) { return this._tx('blobs', 'readwrite', s => s.delete(path)); }
  async loadAll() { const [cats, txs, recurring, settings] = await Promise.all([this.listCategories(), this.listTransactions(), this.listRecurring(), this.getSettings()]); return { cats, txs, recurring, settings }; }
  isPending() { return false; }
  get status() { return { state: 'local', pending: 0 }; }
  onStatus(cb) { cb(this.status); }
  onFailed() {}
  warm() {}
  syncNow() {}
  async wipe() { for (const s of ['categories', 'transactions', 'recurring', 'kv', 'blobs']) await this._tx(s, 'readwrite', st => st.clear()); }
}

export function createStore() {
  const forceLocal = new URLSearchParams(location.search).has('preview');
  return CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && !forceLocal ? new CloudStore() : new LocalStore();
}

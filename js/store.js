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

// Every cloud call gets a deadline, so a stuck connection shows an error instead of spinning forever.
const TIMEOUT_MS = 25000;
function withTimeout(p, ms = TIMEOUT_MS) {
  let tm; const t = new Promise((_, rej) => { tm = setTimeout(() => rej(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' })), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(tm));
}
const isAuthErr = e => /JWT|token is expired|invalid claim|PGRST30[13]/i.test(String(e?.message || '') + ' ' + (e?.code || ''));

// ----------------------------------------------------------------------------- Cloud
class CloudStore {
  mode = 'cloud';
  async init() {
    if (!window.supabase) await loadScript(CONFIG.supabaseJs);
    this.sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'budget.auth' },
    });
    const { data } = await this.sb.auth.getSession();
    this.user = data.session?.user || null;
    return this.user;
  }
  onAuth(cb) { this.sb.auth.onAuthStateChange((ev, s) => { this.user = s?.user || null; cb(ev, this.user); }); }
  async signIn(email, password) { const { data, error } = await this.sb.auth.signInWithPassword({ email, password }); if (error) throw error; this.user = data.user; return data.user; }
  async signUp(email, password) { const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0].split('?')[0] } }); if (error) throw error; return data; }
  async magicLink(email) { const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.href.split('#')[0] } }); if (error) throw error; }
  async resetPassword(email) { const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] }); if (error) throw error; }
  async setPassword(password) { const { error } = await this.sb.auth.updateUser({ password }); if (error) throw error; }
  async signOut() { await this.sb.auth.signOut(); this.user = null; }
  async _run(fn, ms = TIMEOUT_MS) {
    try { return await withTimeout(fn(), ms); }
    catch (e) {
      if (!isAuthErr(e)) throw e;
      const { error } = await withTimeout(this.sb.auth.refreshSession());
      if (error) throw Object.assign(new Error('SESSION_EXPIRED'), { code: 'SESSION_EXPIRED' });
      return await withTimeout(fn(), ms);
    }
  }
  async _all(table, order) {
    const out = []; const step = 1000;
    for (let from = 0; ; from += step) {
      let q = this.sb.from(table).select('*').range(from, from + step - 1);
      for (const [c, asc] of order) q = q.order(c, { ascending: asc });
      const data = await this._run(async () => { const { data, error } = await q; if (error) throw error; return data; });
      out.push(...data); if (data.length < step) break;
    }
    return out;
  }
  listCategories() { return this._all('budget_categories', [['sort', true], ['name', true]]); }
  listTransactions() { return this._all('budget_transactions', [['date', false], ['created_at', false]]); }
  listRecurring() { return this._all('budget_recurring', [['created_at', true]]); }
  async _upsert(table, row, fields) { return this._run(async () => { const { data, error } = await this.sb.from(table).upsert(pick(row, fields)).select().single(); if (error) throw error; return data; }); }
  saveCategory(c) { return this._upsert('budget_categories', c, CAT_FIELDS); }
  saveTransaction(t) { return this._upsert('budget_transactions', t, TX_FIELDS); }
  saveRecurring(r) { return this._upsert('budget_recurring', r, REC_FIELDS); }
  async insertCategories(list) { return this._run(async () => { const { data, error } = await this.sb.from('budget_categories').upsert(list.map(c => pick(c, CAT_FIELDS)), { onConflict: 'user_id,kind,name', ignoreDuplicates: true }).select(); if (error) throw error; return data; }); }
  async insertGenerated(list) {
    if (!list.length) return [];
    return this._run(async () => { const { data, error } = await this.sb.from('budget_transactions').upsert(list.map(t => pick(t, TX_FIELDS)), { onConflict: 'user_id,recurring_id,date', ignoreDuplicates: true }).select(); if (error) throw error; return data; });
  }
  // .select() returns the deleted rows, so "nothing was deleted" (row gone / not yours) is an error, not a silent success
  async _del(table, id) { return this._run(async () => { const { data, error } = await this.sb.from(table).delete().eq('id', id).select('id'); if (error) throw error; if (!data?.length) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' }); }); }
  deleteCategory(id) { return this._del('budget_categories', id); }
  deleteRecurring(id) { return this._del('budget_recurring', id); }
  async deleteTransaction(t) { await this._del('budget_transactions', t.id); if (t.receipt_path) await this.deleteReceipt(t.receipt_path).catch(() => {}); } // row first: a failed delete keeps the receipt
  async getSettings() { return this._run(async () => { const { data, error } = await this.sb.from('budget_settings').select('data').maybeSingle(); if (error) throw error; return data?.data || {}; }); }
  async saveSettings(s) { return this._run(async () => { const { error } = await this.sb.from('budget_settings').upsert({ user_id: this.user.id, data: s, updated_at: new Date().toISOString() }); if (error) throw error; }); }
  async uploadReceipt(txId, file) {
    const path = `${this.user.id}/${txId}/${Date.now()}_${safeName(file.name)}`;
    await this._run(async () => { const { error } = await this.sb.storage.from(CONFIG.receiptsBucket).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false }); if (error) throw error; }, 120000); // big photos on mobile data
    return { receipt_path: path, receipt_name: file.name || 'receipt', receipt_type: file.type || '' };
  }
  async receiptUrl(path, download) {
    const { data, error } = await this.sb.storage.from(CONFIG.receiptsBucket).createSignedUrl(path, CONFIG.signedUrlSeconds, download ? { download: true } : undefined);
    if (error) throw error; return data.signedUrl;
  }
  async receiptBlob(path) { const { data, error } = await this.sb.storage.from(CONFIG.receiptsBucket).download(path); if (error) throw error; return data; }
  async deleteReceipt(path) { return this._run(async () => { const { error } = await this.sb.storage.from(CONFIG.receiptsBucket).remove([path]); if (error) throw error; }); }
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
  async wipe() { for (const s of ['categories', 'transactions', 'recurring', 'kv', 'blobs']) await this._tx(s, 'readwrite', st => st.clear()); }
}

export function createStore() {
  const forceLocal = new URLSearchParams(location.search).has('preview');
  return CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && !forceLocal ? new CloudStore() : new LocalStore();
}

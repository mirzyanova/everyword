import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './cloud-config.js';

const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL)
  && /^(sb_publishable_|eyJ)/.test(SUPABASE_PUBLISHABLE_KEY);

const stamp = c => {
  const reviews = (c.history || []).map(h => h.at || '').sort();
  return c.updatedAt || reviews[reviews.length - 1] || c.createdAt || '1970-01-01T00:00:00.000Z';
};
const cardJSON = c => JSON.stringify(c);
const validCard = c => c && typeof c.id === 'string' &&
  typeof c.ru === 'string' && typeof c.en === 'string' &&
  Array.isArray(c.history);

export function createCloudBridge({ getCards, mergeCards, onStatus }) {
  let client = null, user = null, ready = false, syncing = false, pending = false;
  let snapshots = new Map(), saveTimer = null, status = configured ? 'connecting' : 'unconfigured';
  const setStatus = s => { status = s; onStatus?.(s, user); };
  const api = {
    get configured() { return configured; },
    get status() { return status; },
    get email() { return user?.email || ''; },
    get signedIn() { return !!user; }
  };
  async function loadLibrary() {
    if (!configured || client) return;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.78.0?bundle');
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  async function listRemote() {
    let out = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await client.from('everyword_cards')
        .select('id,payload,updated_at').eq('user_id', user.id)
        .order('updated_at', { ascending: true }).range(from, from + 499);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    return out;
  }
  async function upload(cards) {
    if (!cards.length) return;
    for (let i = 0; i < cards.length; i += 100) {
      const batch = cards.slice(i, i + 100);
      const rows = batch.map(c => ({
        id: c.id, user_id: user.id, payload: c,
        updated_at: new Date().toISOString()
      }));
      const { error } = await client.from('everyword_cards').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      for (const c of batch) snapshots.set(c.id, cardJSON(c));
    }
  }
  async function initialSync() {
    if (!user || syncing) return;
    syncing = true;
    setStatus('syncing');
    try {
      const remote = await listRemote();
      const local = getCards().filter(validCard);
      const remoteMap = new Map(remote.map(x => [x.id, x]));
      const combined = new Map();
      const toUpload = [];
      for (const x of remote) {
        if (validCard(x.payload)) {
          combined.set(x.id, x.payload);
          snapshots.set(x.id, cardJSON(x.payload));
        }
      }
      for (const c of local) {
        const counterpart = remoteMap.get(c.id)?.payload;
        if (!counterpart || stamp(c) > stamp(counterpart)) {
          combined.set(c.id, c);
          toUpload.push(c);
        }
      }
      mergeCards(Array.from(combined.values()));
      await upload(toUpload);
      ready = true;
      setStatus('connected');
    } catch (e) {
      console.error('Everyword initial cloud sync failed', e);
      setStatus('error');
    } finally { syncing = false; }
  }
  async function flush() {
    if (!ready || !user || syncing) { pending = true; return; }
    syncing = true;
    setStatus('syncing');
    try {
      const changed = getCards().filter(validCard).filter(c => snapshots.get(c.id) !== cardJSON(c));
      await upload(changed);
      setStatus('connected');
    } catch (e) {
      console.error('Everyword cloud upload failed', e);
      setStatus('error');
    } finally {
      syncing = false;
      if (pending) { pending = false; setTimeout(() => flush(), 1500); }
    }
  }
  async function pull() {
    if (!ready || !user || syncing) return;
    await flush();
    if (syncing || status === 'error') return;
    syncing = true;
    try {
      const remote = await listRemote();
      const current = new Map(getCards().map(c => [c.id, c]));
      let changed = false;
      for (const row of remote) {
        const c = row.payload;
        if (!validCard(c)) continue;
        const isDirty = current.has(c.id) && snapshots.has(c.id)
          && snapshots.get(c.id) !== cardJSON(current.get(c.id));
        if (isDirty) continue;
        if (!current.has(c.id) || cardJSON(current.get(c.id)) !== cardJSON(c)) {
          current.set(c.id, c);
          changed = true;
        }
        snapshots.set(c.id, cardJSON(c));
      }
      if (changed) mergeCards(Array.from(current.values()));
      if (status !== 'error') setStatus('connected');
    } catch (e) {
      console.error('Everyword cloud refresh failed', e);
      setStatus('error');
    } finally { syncing = false; }
  }
  api.localChange = function() {
    if (!ready || !user) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 700);
  };
  api.refresh = async function() { if (status === 'error') { setStatus('connected'); } await pull(); };
  api.signIn = async function(email) {
    if (!configured) throw new Error('Облако ещё не настроено');
    await loadLibrary();
    const { error } = await client.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) throw error;
    setStatus('email-sent');
  };
  api.signOut = async function() {
    if (client) await client.auth.signOut();
    user = null; ready = false; snapshots.clear();
    setStatus('signed-out');
  };
  api.init = async function() {
    if (!configured) return setStatus('unconfigured');
    try {
      await loadLibrary();
      const { data: { user: currentUser }, error } = await client.auth.getUser();
      if (error && error.name !== 'AuthSessionMissingError') throw error;
      user = currentUser;
      if (user) await initialSync();
      else setStatus('signed-out');
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session?.user && session.user.id !== user?.id) {
          user = session.user;
          setTimeout(initialSync, 0);
        } else if (event === 'SIGNED_OUT') {
          user = null; ready = false; snapshots.clear(); setStatus('signed-out');
        }
      });
    } catch (e) {
      console.error('Everyword cloud initialization failed', e);
      setStatus('error');
    }
  };
  window.addEventListener('focus', () => { if (ready) pull(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ready) pull();
  });
  setInterval(() => { if (ready && !document.hidden) pull(); }, 30000);
  return api;
}

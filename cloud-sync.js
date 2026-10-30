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

export function createCloudBridge({ getCards, mergeCards, getPractices, mergePractices, getShelves, mergeShelves, getRules, mergeRules, onStatus, onIdentity }) {
  let client = null, user = null, ready = false, syncing = false, pending = false;
  let snapshots = new Map(), practiceSnapshots = new Set(), shelfSnapshots = new Map(), ruleSnapshots = new Map(), saveTimer = null, status = configured ? 'connecting' : 'unconfigured';
  const setStatus = s => { status = s; onStatus?.(s, user); };
  const api = {
    get configured() { return configured; },
    get status() { return status; },
    get email() { return user?.email || ''; },
    get signedIn() { return !!user; },
    get ready() { return ready; }
  };
  async function loadLibrary() {
    if (!configured || client) return;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.78.0?bundle');
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  async function listRemote(accountId) {
    let out = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await client.from('everyword_cards')
        .select('id,payload,updated_at').eq('user_id', accountId)
        .order('updated_at', { ascending: true }).range(from, from + 499);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    return out;
  }
  async function listPractices(accountId){
    const records=[];
    for(let from=0;;from+=500){
      const {data,error}=await client.from('everyword_practices')
        .select('id,local_day,kind,completed_at').eq('user_id',accountId)
        .order('completed_at',{ascending:true}).range(from,from+499);
      if(error)throw error;
      records.push(...(data||[]));
      if(!data||data.length<500)break;
    }
    return records.map(row=>({id:row.id,day:row.local_day,kind:row.kind,at:row.completed_at}));
  }
  async function uploadPractices(practices,accountId){
    for(let i=0;i<practices.length;i+=100){
      if(user?.id!==accountId)return;
      const slice=practices.slice(i,i+100);
      const rows=slice.map(p=>({id:p.id,user_id:accountId,local_day:p.day,kind:p.kind,completed_at:p.at}));
      const {error}=await client.from('everyword_practices').upsert(rows,{onConflict:'id',ignoreDuplicates:true});
      if(error)throw error;
      slice.forEach(p=>practiceSnapshots.add(p.id));
    }
  }
  function unionPractices(remote,local){
    const all=new Map(remote.map(p=>[p.id,p]));
    for(const p of local)if(p&&p.id&&!all.has(p.id))all.set(p.id,p);
    return [...all.values()].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  }
  const shelfStamp=s=>String(s?.updatedAt||s?.createdAt||'');
  function mergeShelfSets(local,remote){
    const all=new Map(remote.map(s=>[s.id,s]));
    for(const s of local){
      const prev=all.get(s.id);
      if(!prev||shelfStamp(s)>shelfStamp(prev))all.set(s.id,s);
    }
    return [...all.values()];
  }
  async function listShelves(accountId){
    let entries=[];
    for(let from=0;;from+=500){
      const {data,error}=await client.from('everyword_shelves').select('id,payload,updated_at')
        .eq('user_id',accountId).order('updated_at',{ascending:true}).range(from,from+499);
      if(error)throw error;
      entries.push(...(data||[]));
      if(!data||data.length<500)break;
    }
    return entries.map(r=>r.payload).filter(s=>s&&typeof s.id==='string'&&typeof s.title==='string'&&Array.isArray(s.cardIds));
  }
  async function uploadShelves(entries,accountId){
    for(let i=0;i<entries.length;i+=100){
      if(user?.id!==accountId)return;
      const batch=entries.slice(i,i+100);
      const rows=batch.map(s=>({id:s.id,user_id:accountId,payload:s,updated_at:new Date().toISOString()}));
      const {error}=await client.from('everyword_shelves').upsert(rows,{onConflict:'id'});
      if(error)throw error;
      batch.forEach(s=>shelfSnapshots.set(s.id,cardJSON(s)));
    }
  }
  function mergeRuleSets(local,remote){
    const all=new Map(remote.map(r=>[r.id,r]));
    for(const r of local){
      const previous=all.get(r.id);
      if(!previous||String(r.updatedAt||'')>String(previous.updatedAt||''))all.set(r.id,r);
    }
    return [...all.values()];
  }
  async function listRules(accountId){
    const items=[];
    for(let from=0;;from+=500){
      const {data,error}=await client.from('everyword_rules')
        .select('id,payload,updated_at').eq('user_id',accountId)
        .order('updated_at',{ascending:true}).range(from,from+499);
      if(error)throw error;
      items.push(...(data||[]));
      if(!data||data.length<500)break;
    }
    return items.map(row=>row.payload).filter(rule=>rule&&typeof rule.id==='string'&&typeof rule.title==='string');
  }
  async function uploadRules(rules,accountId){
    for(let i=0;i<rules.length;i+=100){
      if(user?.id!==accountId)return;
      const batch=rules.slice(i,i+100);
      const rows=batch.map(rule=>({id:rule.id,user_id:accountId,payload:rule,updated_at:new Date().toISOString()}));
      const {error}=await client.from('everyword_rules').upsert(rows,{onConflict:'id'});
      if(error)throw error;
      batch.forEach(rule=>ruleSnapshots.set(rule.id,cardJSON(rule)));
    }
  }
  async function upload(cards, accountId) {
    if (!cards.length) return;
    for (let i = 0; i < cards.length; i += 100) {
      const batch = cards.slice(i, i + 100);
      if (user?.id !== accountId) return;
      const rows = batch.map(c => ({
        id: c.id, user_id: accountId, payload: c,
        updated_at: new Date().toISOString()
      }));
      const { error } = await client.from('everyword_cards').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
      for (const c of batch) snapshots.set(c.id, cardJSON(c));
    }
  }
  async function initialSync() {
    if (!user || syncing) return;
    const accountId = user.id;
    syncing = true;
    setStatus('syncing');
    try {
      const [remote,remotePractices,remoteShelves,remoteRules] = await Promise.all([listRemote(accountId),listPractices(accountId),listShelves(accountId),listRules(accountId)]);
      if (user?.id !== accountId) return;
      const local = getCards().filter(validCard);
      const localPractices=(getPractices?.()||[]).filter(p=>p&&p.id&&p.day&&p.kind&&p.at);
      const localShelves=(getShelves?.()||[]).filter(s=>s?.id&&s?.title&&Array.isArray(s.cardIds));
      const localRules=(getRules?.()||[]).filter(r=>r?.id&&r?.title);
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
      mergePractices?.(unionPractices(remotePractices,localPractices));
      const mergedShelves=mergeShelfSets(localShelves,remoteShelves);
      mergeShelves?.(mergedShelves);
      remoteShelves.forEach(s=>shelfSnapshots.set(s.id,cardJSON(s)));
      const mergedRules=mergeRuleSets(localRules,remoteRules);
      mergeRules?.(mergedRules);
      remoteRules.forEach(r=>ruleSnapshots.set(r.id,cardJSON(r)));
      const remoteRuleMap=new Map(remoteRules.map(r=>[r.id,r]));
      const ruleUpdates=mergedRules.filter(r=>!remoteRuleMap.has(r.id)||String(r.updatedAt)>String(remoteRuleMap.get(r.id).updatedAt));
      const remoteShelfMap=new Map(remoteShelves.map(s=>[s.id,s]));
      const shelfUpdates=mergedShelves.filter(s=>!remoteShelfMap.has(s.id)||shelfStamp(s)>shelfStamp(remoteShelfMap.get(s.id)));
      remotePractices.forEach(p=>practiceSnapshots.add(p.id));
      await upload(toUpload, accountId);
      await uploadPractices(localPractices.filter(p=>!practiceSnapshots.has(p.id)),accountId);
      await uploadShelves(shelfUpdates,accountId);
      await uploadRules(ruleUpdates,accountId);
      if (user?.id !== accountId) return;
      ready = true;
      setStatus('connected');
    } catch (e) {
      console.error('Everyword initial cloud sync failed', e);
      setStatus('error');
    } finally { syncing = false; }
  }
  async function flush() {
    if (!ready || !user || syncing) { pending = true; return; }
    const accountId = user.id;
    syncing = true;
    setStatus('syncing');
    try {
      const changed = getCards().filter(validCard).filter(c => snapshots.get(c.id) !== cardJSON(c));
      const practiceChanges=(getPractices?.()||[]).filter(p=>p?.id&&!practiceSnapshots.has(p.id));
      const shelfChanges=(getShelves?.()||[]).filter(s=>s?.id&&shelfSnapshots.get(s.id)!==cardJSON(s));
      const ruleChanges=(getRules?.()||[]).filter(r=>r?.id&&ruleSnapshots.get(r.id)!==cardJSON(r));
      await upload(changed, accountId);
      await uploadPractices(practiceChanges,accountId);
      await uploadShelves(shelfChanges,accountId);
      await uploadRules(ruleChanges,accountId);
      if (user?.id !== accountId) return;
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
    const accountId = user.id;
    syncing = true;
    try {
      const [remote,remotePractices,remoteShelves,remoteRules] = await Promise.all([listRemote(accountId),listPractices(accountId),listShelves(accountId),listRules(accountId)]);
      if (user?.id !== accountId) return;
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
      const localPractices=getPractices?.()||[];
      const union=unionPractices(remotePractices,localPractices);
      if(union.length!==localPractices.length)mergePractices?.(union);
      remotePractices.forEach(p=>practiceSnapshots.add(p.id));
      const beforeShelves=getShelves?.()||[];
      const mergedShelves=mergeShelfSets(beforeShelves,remoteShelves);
      if(JSON.stringify(mergedShelves)!==JSON.stringify(beforeShelves))mergeShelves?.(mergedShelves);
      remoteShelves.forEach(s=>{if(!beforeShelves.some(l=>l.id===s.id&&shelfStamp(l)>shelfStamp(s)))shelfSnapshots.set(s.id,cardJSON(s))});
      const existingRules=getRules?.()||[];
      const combinedRules=mergeRuleSets(existingRules,remoteRules);
      if(JSON.stringify(combinedRules)!==JSON.stringify(existingRules))mergeRules?.(combinedRules);
      remoteRules.forEach(r=>{if(!existingRules.some(l=>l.id===r.id&&String(l.updatedAt)>String(r.updatedAt)))ruleSnapshots.set(r.id,cardJSON(r))});
      setStatus('connected');
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
  api.refresh = async function() { if (!user) return; if (!ready) await initialSync(); else await pull(); };
  api.signIn = async function(email) {
    if (!configured) throw new Error('Облако ещё не настроено');
    await loadLibrary();
    const { error } = await client.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) throw error;
    setStatus('email-sent');
  };
  function setIdentity(nextUser) {
    if (user?.id === nextUser?.id) { user = nextUser; return false; }
    user = nextUser;
    ready = false;
    snapshots.clear();
    practiceSnapshots.clear();
    shelfSnapshots.clear();
    ruleSnapshots.clear();
    clearTimeout(saveTimer);
    onIdentity?.(user);
    return true;
  }
  api.signOut = async function() {
    if (client) {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }
    setIdentity(null);
    setStatus('signed-out');
  };
  api.init = async function() {
    if (!configured) return setStatus('unconfigured');
    try {
      await loadLibrary();
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          if (setIdentity(session.user)) setTimeout(initialSync, 0);
        } else if (event === 'SIGNED_OUT') {
          setIdentity(null);
          setStatus('signed-out');
        }
      });
      const { data: { user: currentUser }, error } = await client.auth.getUser();
      if (error && error.name !== 'AuthSessionMissingError') throw error;
      if (currentUser) {
        setIdentity(currentUser);
        if (!ready) await initialSync();
      } else if (!user) {
        setIdentity(null);
        setStatus('signed-out');
      }
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

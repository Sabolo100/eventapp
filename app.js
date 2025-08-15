import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, BACKEND_URL } from './config.js';

const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const el = (id) => document.getElementById(id);
const viewHome = el('home');
const viewDash = el('dashboard');
const sessionBox = el('session-box');

el('nav-home').onclick = ()=> show('home');
el('nav-dashboard').onclick = ()=> show('dashboard');
el('btn-signout').onclick = async ()=> { await supa.auth.signOut(); location.reload(); };

function show(which){
  for (const s of [viewHome, viewDash]) s.classList.add('hidden');
  if (which === 'home') viewHome.classList.remove('hidden');
  if (which === 'dashboard') viewDash.classList.remove('hidden');
}

// Magic link sign-in
el('btn-magic').onclick = async ()=>{
  const email = el('auth-email').value.trim();
  if (!email) return;
  const { error } = await supa.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } });
  el('auth-msg').textContent = error ? 'Error: ' + error.message : 'Check your email for the sign-in link.';
};

let session = null;
supa.auth.onAuthStateChange(async (_event, s) => {
  session = s;
  renderSession();
  if (session) {
    await loadEvents();
    show('dashboard');
  } else {
    show('home');
  }
});

async function getUser() {
  const { data } = await supa.auth.getUser();
  return data.user || null;
}

function renderSession() {
  if (!session) {
    sessionBox.classList.add('hidden');
    return;
  }
  sessionBox.classList.remove('hidden');
  el('session-info').textContent = JSON.stringify({
    user: session.user?.email,
    sub: session.user?.id
  }, null, 2);
}

// Events
const listEl = el('events');
const titleEl = el('event-title');
const langEl = el('event-lang');

el('btn-create').onclick = async ()=>{
  const user = await getUser();
  if (!user) return alert('Sign in first.');
  const { error } = await supa.from('events').insert({
    owner_id: user.id,
    title: titleEl.value.trim() || 'Untitled Event',
    language: langEl.value
  });
  if (error) return alert('Create failed: ' + error.message);
  await loadEvents();
  titleEl.value = '';
};

el('btn-refresh').onclick = ()=> loadEvents();

async function loadEvents(){
  const user = await getUser();
  if (!user) return;
  const { data, error } = await supa
    .from('events')
    .select('id,title,language,status,drive_folder_link,created_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });
  if (error) { listEl.innerHTML = '<li>Error loading events.</li>'; return; }
  listEl.innerHTML = '';
  (data || []).forEach(ev => {
    const li = document.createElement('li');
    li.innerHTML = \`
      <b>\${ev.title}</b> — \${ev.language} — <i>\${ev.status}</i>
      \${ev.drive_folder_link ? ' — <a href="'+ev.drive_folder_link+'" target="_blank">Drive folder</a>' : ''}
      <button class="tiny" data-open="\${ev.id}">Open</button>
    \`;
    listEl.appendChild(li);
  });
  listEl.querySelectorAll('button[data-open]').forEach(btn => {
    btn.onclick = () => openEvent(btn.getAttribute('data-open'));
  });
}

// Event detail
let currentEventId = null;
const detail = document.getElementById('event-detail');
const meta = document.getElementById('event-meta');
const artifactsEl = document.getElementById('artifacts');
const conceptsEl = document.getElementById('concepts');
const inputsArea = document.getElementById('inputs-json');
const inputsMsg = document.getElementById('inputs-msg');

async function openEvent(id){
  currentEventId = id;
  detail.classList.remove('hidden');
  const { data: ev } = await supa.from('events').select('id,title,language,status,drive_folder_link').eq('id', id).single();
  meta.innerHTML = \`
    <div><b>Title:</b> \${ev.title}</div>
    <div><b>Language:</b> \${ev.language}</div>
    <div><b>Status:</b> \${ev.status}</div>
    \${ev.drive_folder_link ? '<div><a target="_blank" href="'+ev.drive_folder_link+'">Open folder</a></div>' : ''}
  \`;
  const { data: inp } = await supa.from('event_inputs').select('version,payload').eq('event_id', id).maybeSingle();
  inputsArea.value = JSON.stringify(inp || {
    version: '1.0',
    payload: {
      basics: {
        title: ev.title,
        type: 'corporate',
        language: ev.language,
        timezone: 'Europe/Budapest',
        date_range: { start: '2025-12-01', end: '2025-12-01' },
        location: { mode: 'onsite', city: 'Budapest', country: 'HU' },
        expected_attendees: 80
      }
    }
  }, null, 2);
  await Promise.all([loadArtifacts(), loadConcepts()]);
}

async function loadArtifacts(){
  const { data, error } = await supa
    .from('artifacts')
    .select('id,type,title,drive_web_link,created_at')
    .eq('event_id', currentEventId)
    .order('created_at', { ascending: false });
  artifactsEl.innerHTML = '';
  if (error) { artifactsEl.innerHTML = '<li>Error loading artifacts.</li>'; return; }
  (data || []).forEach(a => {
    const li = document.createElement('li');
    li.innerHTML = \`\${a.type} — <a href="\${a.drive_web_link}" target="_blank">\${a.title || 'open'}</a>\`;
    artifactsEl.appendChild(li);
  });
}

async function loadConcepts(){
  const { data, error } = await supa
    .from('concepts')
    .select('id,label,prompt_profile,selected,drive_web_link,created_at')
    .eq('event_id', currentEventId)
    .order('label', { ascending: true });
  conceptsEl.innerHTML = '';
  if (error) { conceptsEl.innerHTML = '<li>Error loading concepts.</li>'; return; }
  (data || []).forEach(c => {
    const li = document.createElement('li');
    li.innerHTML = \`<b>\${c.label}</b> — \${c.prompt_profile} — <a href="\${c.drive_web_link}" target="_blank">open</a> \${c.selected ? '(selected)' : ''}\`;
    conceptsEl.appendChild(li);
  });
}

document.getElementById('btn-save-inputs').onclick = async ()=>{
  try {
    const parsed = JSON.parse(inputsArea.value);
    const { error } = await supa.from('event_inputs').upsert({
      event_id: currentEventId,
      version: '1.0',
      payload: parsed.payload
    });
    inputsMsg.textContent = error ? ('Error: ' + error.message) : 'Saved ✓';
    if (!error) setTimeout(()=> inputsMsg.textContent = '', 1500);
  } catch (e) {
    inputsMsg.textContent = 'Invalid JSON';
  }
};

document.querySelectorAll('button[data-select]').forEach(btn => {
  btn.onclick = async ()=>{
    const label = btn.getAttribute('data-select');
    if (!BACKEND_URL) return alert('Set BACKEND_URL in config.js to use server actions.');
    const r = await fetch(\`\${BACKEND_URL}/api/events/\${currentEventId}/select-concept\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label })
    });
    const out = await r.json().catch(()=> ({}));
    if (!r.ok) alert('Select failed: ' + JSON.stringify(out));
    else alert('Selection queued.');
  };
});

document.getElementById('btn-folder').onclick = async ()=>{
  if (!BACKEND_URL) return alert('Set BACKEND_URL in config.js');
  const r = await fetch(\`\${BACKEND_URL}/api/events/\${currentEventId}/request-folder\`, { method: 'POST' });
  if (!r.ok) alert('Request failed'); else alert('Folder request sent.');
};
document.getElementById('btn-concepts').onclick = async ()=>{
  if (!BACKEND_URL) return alert('Set BACKEND_URL in config.js');
  const r = await fetch(\`\${BACKEND_URL}/api/events/\${currentEventId}/request-concepts\`, { method: 'POST' });
  if (!r.ok) alert('Request failed'); else alert('Concepts requested.');
};
document.getElementById('btn-packs').onclick = async ()=>{
  if (!BACKEND_URL) return alert('Set BACKEND_URL in config.js');
  const r = await fetch(\`\${BACKEND_URL}/api/events/\${currentEventId}/request-packs\`, { method: 'POST' });
  if (!r.ok) alert('Request failed'); else alert('Packs requested.');
};

(async ()=>{
  const { data: { session } } = await supa.auth.getSession();
  if (session) {
    show('dashboard');
    renderSession();
    loadEvents();
  } else {
    show('home');
  }
})();
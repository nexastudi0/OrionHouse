const SUPABASE_URL = 'https://dgvlgxwclgstvyjgekwr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_cRCWAEHYsDikPdjaIdi7SA_Xs7NXCts';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const LOGIN_ALIASES = {
  casa: 'orionhouse@gmail.com'
};

let currentMode = null;
let currentUser = null;
let realtimeChannel = null;
let voiceInitialized = false;
let items = [];
let activeFilter = 'Todos';
let recognition = null;
let listening = false;
let alwaysListening = false;
let waitingForCommand = false;
let wakeTimer = null;
let restartTimer = null;
let speaking = false;
let wakeLock = null;
let screensaverActive = false;
let micStream = null;
let recognitionStarting = false;
let lastRestartAt = 0;

const els = {
  list: document.getElementById('list'),
  empty: document.getElementById('emptyState'),
  total: document.getElementById('totalCount'),
  pending: document.getElementById('pendingCount'),
  done: document.getElementById('doneCount'),
  form: document.getElementById('itemForm'),
  name: document.getElementById('itemName'),
  qty: document.getElementById('itemQty'),
  category: document.getElementById('itemCategory'),
  voiceBtn: document.getElementById('voiceBtn'),
  heard: document.getElementById('heardText'),
  micStatus: document.getElementById('micStatus'),
  toast: document.getElementById('toast'),
  loginScreen: document.getElementById('loginScreen'),
  appShell: document.getElementById('appShell'),
  loginForm: document.getElementById('loginForm'),
  loginUser: document.getElementById('loginUser'),
  loginPass: document.getElementById('loginPass'),
  loginHint: document.getElementById('loginHint'),
  logoutBtn: document.getElementById('logoutBtn'),
  modeSubtitle: document.getElementById('modeSubtitle'),
  screensaverBtn: document.getElementById('screensaverBtn'),
  screensaver: document.getElementById('screensaver'),
  screensaverExit: document.getElementById('screensaverExit'),
  cloudStatus: document.getElementById('cloudStatus')
};

function uid(){ return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function cap(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
function escapeHtml(s){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
function notify(msg){ els.toast.textContent = msg; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'),2400); }
function setCloudStatus(text, ok=true){ if(!els.cloudStatus) return; els.cloudStatus.textContent=text; els.cloudStatus.dataset.ok = ok ? '1' : '0'; }

function guessCategory(name){
  const n = name.toLowerCase();
  if (/(detergente|sabão|sabao|desinfetante|amaciante|água sanitária|agua sanitaria|esponja|limpador)/.test(n)) return 'Limpeza';
  if (/(shampoo|sabonete|pasta de dente|creme dental|papel higiênico|papel higienico|desodorante)/.test(n)) return 'Higiene';
  if (/(lâmpada|lampada|pilha|parafuso|fita isolante|ferramenta|tomada)/.test(n)) return 'Manutenção';
  if (/(arroz|feijão|feijao|leite|pão|pao|carne|café|cafe|queijo|refrigerante|fruta|verdura|óleo|oleo|açúcar|acucar|sal)/.test(n)) return 'Mercado';
  return 'Outros';
}

function render(){
  const shown = items
    .filter(i => activeFilter === 'Todos' || i.category === activeFilter)
    .sort((a,b)=> Number(a.done)-Number(b.done) || new Date(b.created_at)-new Date(a.created_at));
  els.list.innerHTML = '';
  els.empty.style.display = shown.length ? 'none' : 'block';
  shown.forEach(item=>{
    const row = document.createElement('div');
    row.className = 'item'+(item.done?' done':'');
    const deleteButton = currentMode === 'home' ? `<button class="delete-btn" aria-label="Excluir ${escapeHtml(item.name)}">Excluir</button>` : '';
    row.innerHTML = `
      <input class="check" type="checkbox" ${item.done?'checked':''} aria-label="Marcar ${escapeHtml(item.name)} como comprado">
      <div class="item-main"><div class="item-name">${escapeHtml(item.name)}</div><div class="item-meta">${item.quantity}x • ${escapeHtml(item.category)}</div></div>
      ${deleteButton}`;
    row.querySelector('.check').addEventListener('change', async e=>{
      const old = item.done;
      item.done = e.target.checked;
      render();
      const { error } = await sb.from('shopping_items').update({done:item.done}).eq('id',item.id);
      if(error){ item.done=old; render(); notify('Não foi possível atualizar o item.'); console.error(error); }
    });
    const del = row.querySelector('.delete-btn');
    if(del) del.addEventListener('click',()=>deleteItem(item.id));
    els.list.appendChild(row);
  });
  els.total.textContent = items.length;
  els.done.textContent = items.filter(i=>i.done).length;
  els.pending.textContent = items.filter(i=>!i.done).length;
}

async function loadItems(showError=true){
  setCloudStatus('☁ Sincronizando…');
  const { data, error } = await sb.from('shopping_items').select('*').order('created_at',{ascending:false});
  if(error){
    console.error(error);
    setCloudStatus('☁ Sem sincronização', false);
    if(showError) notify('Erro ao carregar a lista do Supabase.');
    return false;
  }
  items = data || [];
  render();
  setCloudStatus('☁ Sincronizado');
  return true;
}

async function addItem(name, qty=1, category){
  name = String(name).trim().replace(/[.,;!?]+$/,'');
  if(!name) return false;
  const payload = { name:cap(name), quantity:Number(qty)||1, category:category||guessCategory(name), done:false };
  const { error } = await sb.from('shopping_items').insert(payload);
  if(error){ console.error(error); notify('Não foi possível adicionar o item.'); return false; }
  await loadItems(false);
  return true;
}

async function deleteItem(id){
  const { error } = await sb.from('shopping_items').delete().eq('id',id);
  if(error){ console.error(error); notify('Não foi possível excluir o item.'); return; }
  await loadItems(false);
  notify('Item removido.');
}

els.form.addEventListener('submit',async e=>{
  e.preventDefault();
  const ok=await addItem(els.name.value,els.qty.value,els.category.value);
  if(ok){ els.name.value=''; els.qty.value=1; notify('Item adicionado.'); els.name.focus(); }
});

document.querySelectorAll('.filter').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.filter').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); activeFilter=btn.dataset.filter; render();
}));

document.getElementById('clearDoneBtn').addEventListener('click',async()=>{
  if(!items.some(i=>i.done)) return notify('Nenhum item comprado.');
  const { error } = await sb.from('shopping_items').delete().eq('done',true);
  if(error){ console.error(error); return notify('Não foi possível limpar os comprados.'); }
  await loadItems(false); notify('Itens comprados removidos.');
});

document.getElementById('clearAllBtn').addEventListener('click',async()=>{
  if(!items.length) return notify('A lista já está vazia.');
  if(!confirm('Deseja limpar toda a lista?')) return;
  const ids=items.map(i=>i.id);
  const { error } = await sb.from('shopping_items').delete().in('id',ids);
  if(error){ console.error(error); return notify('Não foi possível limpar a lista.'); }
  await loadItems(false); notify('Lista limpa.');
});

document.getElementById('speakListBtn').addEventListener('click',speakPendingList);

function speak(text){
  if(!('speechSynthesis' in window)) return notify('Leitura de voz não disponível neste navegador.');
  speaking = true;
  if(recognition && listening){ try{ recognition.stop(); }catch(_){} }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang='pt-BR'; u.rate=.95;
  u.onend = u.onerror = ()=>{ speaking=false; scheduleRestart(450); };
  speechSynthesis.speak(u);
}
function speakPendingList(){
  const pending = items.filter(i=>!i.done);
  if(!pending.length) return speak('Sua lista está vazia.');
  speak('Ainda faltam: '+pending.map(i=>`${i.quantity} ${i.name}`).join(', ')+'.');
}

function updateVoiceUI(){
  if(!recognition) return;
  if(alwaysListening){
    els.voiceBtn.classList.add('listening');
    els.voiceBtn.querySelector('span:last-child').textContent='Desativar Orion';
    els.micStatus.textContent = waitingForCommand ? '● Pode falar' : '● Orion ativo';
    els.screensaverBtn.disabled = false;
  } else {
    els.voiceBtn.classList.remove('listening');
    els.voiceBtn.querySelector('span:last-child').textContent='Ativar Orion';
    els.micStatus.textContent='● Orion desligado';
    els.screensaverBtn.disabled = true;
    if(screensaverActive) exitScreensaver();
  }
}

async function ensureMicPermission(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return true;
  try{
    if(!micStream) micStream = await navigator.mediaDevices.getUserMedia({audio:true});
    return true;
  }catch(err){
    els.heard.textContent='Microfone bloqueado. Libere a permissão do microfone no navegador.';
    notify('Permissão do microfone necessária.'); return false;
  }
}
function releaseMic(){ if(micStream){ try{micStream.getTracks().forEach(t=>t.stop());}catch(_){} micStream=null; } }
async function startRecognition(){
  if(!recognition || !alwaysListening || listening || speaking || recognitionStarting) return;
  recognitionStarting=true;
  const ok=await ensureMicPermission();
  if(!ok){ alwaysListening=false; recognitionStarting=false; updateVoiceUI(); return; }
  try{ recognition.start(); }catch(err){ scheduleRestart(700); }
  finally{ recognitionStarting=false; }
}
function scheduleRestart(delay=350){
  clearTimeout(restartTimer);
  if(!alwaysListening || speaking) return;
  const now=Date.now();
  const guard=Math.max(delay,250-(now-lastRestartAt));
  restartTimer=setTimeout(()=>{ lastRestartAt=Date.now(); startRecognition(); },guard);
}
function armWakeWindow(){
  waitingForCommand=true; clearTimeout(wakeTimer); updateVoiceUI();
  els.heard.textContent='Orion ativado. Pode falar o comando.';
  wakeTimer=setTimeout(()=>{waitingForCommand=false;updateVoiceUI();els.heard.textContent='Aguardando você dizer “Orion”...';},9000);
}
function setupVoice(){
  if(voiceInitialized) return; voiceInitialized=true;
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(location.protocol==='file:') els.heard.textContent='Para o microfone funcionar corretamente, publique o sistema em HTTPS ou use INICIAR-ORION.bat.';
  else if(!window.isSecureContext && location.hostname!=='localhost') els.heard.textContent='O Orion precisa de HTTPS ou localhost para usar o microfone.';
  if(!SR){ els.voiceBtn.disabled=true; els.heard.textContent='Use Chrome ou Edge para reconhecimento de voz.'; els.micStatus.textContent='● Voz indisponível'; return; }
  recognition=new SR(); recognition.lang='pt-BR'; recognition.interimResults=true; recognition.continuous=true; recognition.maxAlternatives=3;
  recognition.onstart=()=>{ listening=true; els.heard.textContent=waitingForCommand?'Pode falar o comando.':'Aguardando você dizer “Orion”...'; updateVoiceUI(); };
  recognition.onend=()=>{ listening=false; scheduleRestart(800); };
  recognition.onerror=e=>{
    listening=false;
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){
      alwaysListening=false; updateVoiceUI(); els.heard.textContent='Permita o acesso ao microfone para ativar o Orion.'; notify('Permita acesso ao microfone.'); return;
    }
    if(e.error!=='no-speech'&&e.error!=='aborted') els.heard.textContent='O microfone reiniciou. Aguardando “Orion”...';
    scheduleRestart(600);
  };
  recognition.onresult=e=>{
    if(speaking) return;
    for(let i=e.resultIndex;i<e.results.length;i++){
      const result=e.results[i]; let transcript='';
      for(let a=0;a<result.length;a++){
        const candidate=result[a].transcript.trim();
        if(/\b[oó]rion\b/i.test(candidate)){transcript=candidate;break;}
        if(!transcript) transcript=candidate;
      }
      if(!result.isFinal){if(transcript) els.heard.textContent=`Ouvindo: “${transcript}”`;continue;}
      if(transcript) processVoiceTranscript(transcript);
    }
  };
  updateVoiceUI();
}

async function requestWakeLock(){
  if(!('wakeLock' in navigator)||!alwaysListening||currentMode!=='home') return;
  try{wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{wakeLock=null;});}catch(_){wakeLock=null;}
}
function releaseWakeLock(){if(wakeLock){try{wakeLock.release();}catch(_){}wakeLock=null;}}
function enterScreensaver(){if(currentMode!=='home')return;if(!alwaysListening){notify('Ative o Orion antes da tela de descanso.');return;}screensaverActive=true;els.screensaver.classList.remove('hidden');els.screensaver.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';requestWakeLock();}
function exitScreensaver(){screensaverActive=false;els.screensaver.classList.add('hidden');els.screensaver.setAttribute('aria-hidden','true');document.body.style.overflow='';releaseWakeLock();}
els.screensaverBtn.addEventListener('click',enterScreensaver);
els.screensaverExit.addEventListener('click',exitScreensaver);
els.screensaver.addEventListener('dblclick',exitScreensaver);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&screensaverActive)requestWakeLock();});

els.voiceBtn.addEventListener('click',async()=>{
  if(!recognition)return;
  const turningOn=!alwaysListening;
  if(turningOn){const ok=await ensureMicPermission();if(!ok)return;}
  alwaysListening=turningOn;waitingForCommand=false;clearTimeout(wakeTimer);
  if(alwaysListening){els.heard.textContent='Aguardando você dizer “Orion”...';updateVoiceUI();startRecognition();}
  else{clearTimeout(restartTimer);try{recognition.stop();}catch(_){}releaseMic();els.heard.textContent='Orion desativado. Toque em “Ativar Orion” para voltar a ouvir.';updateVoiceUI();}
});

function processVoiceTranscript(raw){
  const normalized=raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const wakeMatch=normalized.match(/(?:^|\b)orion\b[,:;!?]?\s*(.*)$/i);
  if(wakeMatch){const command=(wakeMatch[1]||'').trim();if(command){waitingForCommand=false;clearTimeout(wakeTimer);updateVoiceUI();els.heard.textContent=`Comando: “${command}”`;handleCommand(command);}else armWakeWindow();return;}
  if(waitingForCommand){waitingForCommand=false;clearTimeout(wakeTimer);updateVoiceUI();els.heard.textContent=`Comando: “${raw}”`;handleCommand(raw);}
}
function cleanAddCommand(text){
  return text
    .replace(/^(por favor\s+)?(adiciona|adicione|adicionar|coloca|coloque|colocar|bota|bote|botar|inclui|inclua|incluir|anota|anote|anotar|preciso de|precisamos de|quero|quero comprar)\s+/i,'')
    .replace(/\s+(na|à|a|pra|para)\s+(minha\s+)?lista(?:\s+(do|de)\s+mercado)?\s*$/i,'')
    .replace(/\s+(na|à|a|pra|para)\s+lista\s*$/i,'').replace(/[.!?]+$/,'').trim();
}
async function handleCommand(raw){
  let text=raw.toLowerCase().trim().replace(/^orion\b[,:;!?]?\s*/i,'');
  if(/(o que falta|o que ainda falta|ler lista|leia a lista|qual a lista)/.test(text)){speakPendingList();return;}
  if(/(limpar|apagar) (a |minha )?lista/.test(text)){
    if(!items.length){speak('Sua lista já está vazia.');return;}
    const {error}=await sb.from('shopping_items').delete().in('id',items.map(i=>i.id));
    if(error){speak('Não consegui limpar a lista.');return;} await loadItems(false); speak('Lista limpa.'); notify('Lista limpa por voz.'); return;
  }
  if(/(limpar|apagar|remover) (os )?(comprados|itens comprados)/.test(text)){
    const {error}=await sb.from('shopping_items').delete().eq('done',true);
    if(error){speak('Não consegui remover os itens comprados.');return;} await loadItems(false); speak('Itens comprados removidos.'); return;
  }
  const removeMatch=text.match(/(?:remover|remove|remova|tirar|tira|apagar|apaga)\s+(.+?)(?:\s+(?:da|de|na)\s+(?:minha\s+)?lista)?$/);
  if(removeMatch){const target=removeMatch[1].trim();const item=items.find(i=>i.name.toLowerCase().includes(target));if(item){const {error}=await sb.from('shopping_items').delete().eq('id',item.id);if(!error){await loadItems(false);speak(`${item.name} removido da lista.`);}else speak('Não consegui remover o item.');}else speak(`Não encontrei ${target} na lista.`);return;}
  const markMatch=text.match(/(?:marcar|marca|marque)\s+(.+?)\s+(?:como )?(?:comprado|comprada|pego|pega|feito|feita)/);
  if(markMatch){const target=markMatch[1].trim();const item=items.find(i=>i.name.toLowerCase().includes(target));if(item){const {error}=await sb.from('shopping_items').update({done:true}).eq('id',item.id);if(!error){await loadItems(false);speak(`${item.name} marcado como comprado.`);}else speak('Não consegui atualizar o item.');}else speak(`Não encontrei ${target}.`);return;}
  text=cleanAddCommand(text); if(!text){speak('Não entendi o item.');return;}
  const parts=text.split(/,|\s+e\s+/).map(s=>s.trim()).filter(Boolean); const added=[];
  for(const part of parts){let qty=1,name=part;const m=part.match(/^(\d+)\s+(.+)$/);if(m){qty=Number(m[1]);name=m[2];}name=name.replace(/^(um|uma)\s+/,'').trim();if(!name)continue;const ok=await addItem(name,qty,guessCategory(name));if(ok)added.push(`${qty>1?qty+' ':''}${name}`);}
  if(!added.length){speak('Não consegui adicionar o item.');return;}
  speak(`Adicionei ${added.join(', ')} à lista.`); notify(added.length===1?`${cap(added[0])} adicionado.`:'Itens adicionados por voz.');
}

let selectedAccessMode='home';
function selectAccessMode(mode){selectedAccessMode=mode;document.querySelectorAll('.access-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===mode));els.loginHint.textContent=mode==='home'?'Acesso Casa: voz e gerenciamento completo.':'Acesso Rua: somente a lista, sem comando de voz.';}
document.querySelectorAll('.access-tab').forEach(btn=>btn.addEventListener('click',()=>selectAccessMode(btn.dataset.mode)));

async function getProfileRole(userId){
  const {data,error}=await sb.from('profiles').select('role').eq('id',userId).single();
  if(error){console.error(error);return null;} return data?.role||null;
}

function stopRealtime(){if(realtimeChannel){sb.removeChannel(realtimeChannel);realtimeChannel=null;}}
function startRealtime(){
  stopRealtime();
  realtimeChannel=sb.channel('orion-shopping-list')
    .on('postgres_changes',{event:'*',schema:'public',table:'shopping_items'},()=>loadItems(false))
    .subscribe(status=>{if(status==='SUBSCRIBED')setCloudStatus('☁ Tempo real ativo');});
}

async function applyMode(mode){
  currentMode=mode;
  document.body.classList.toggle('street-mode',mode==='street');
  els.loginScreen.classList.add('hidden'); els.appShell.classList.remove('hidden');
  els.modeSubtitle.textContent=mode==='street'?'Lista sincronizada para usar fora de casa.':'Assistente doméstico sincronizado com a nuvem.';
  if(mode==='street'){
    alwaysListening=false;waitingForCommand=false;speaking=false;clearTimeout(restartTimer);clearTimeout(wakeTimer);
    if(recognition&&listening){try{recognition.stop();}catch(_){}} releaseMic(); els.micStatus.textContent='● Modo Rua';
  }else{setupVoice();updateVoiceUI();}
  await loadItems(); startRealtime(); render();
}

els.loginForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const raw=els.loginUser.value.trim().toLowerCase();
  const email=LOGIN_ALIASES[raw]||raw;
  const password=els.loginPass.value;
  setCloudStatus('☁ Entrando…');
  const {data,error}=await sb.auth.signInWithPassword({email,password});
  if(error){console.error(error);setCloudStatus('☁ Aguardando login',false);return notify('Usuário/e-mail ou senha incorretos.');}
  const role=await getProfileRole(data.user.id);
  if(!role){await sb.auth.signOut();return notify('Este usuário ainda não tem perfil Casa/Rua configurado. Rode o SQL de configuração.');}
  if(role!==selectedAccessMode){await sb.auth.signOut();return notify(role==='home'?'Este login pertence ao acesso Casa.':'Este login pertence ao acesso Rua.');}
  currentUser=data.user; els.loginPass.value=''; await applyMode(role);
});

els.logoutBtn.addEventListener('click',async()=>{
  stopRealtime(); alwaysListening=false;waitingForCommand=false;clearTimeout(restartTimer);clearTimeout(wakeTimer);
  if(recognition&&listening){try{recognition.stop();}catch(_){}} releaseMic(); exitScreensaver();
  await sb.auth.signOut(); currentUser=null;currentMode=null;items=[];render();
  els.appShell.classList.add('hidden');els.loginScreen.classList.remove('hidden');els.loginUser.value='';els.loginPass.value='';selectAccessMode('home');setCloudStatus('☁ Aguardando login');
});

async function restoreSession(){
  const {data:{session}}=await sb.auth.getSession();
  if(!session){setCloudStatus('☁ Aguardando login');return;}
  currentUser=session.user;
  const role=await getProfileRole(session.user.id);
  if(role==='home'||role==='street'){selectAccessMode(role);await applyMode(role);}else{await sb.auth.signOut();notify('Perfil de acesso não configurado no Supabase.');}
}

sb.auth.onAuthStateChange((event,session)=>{
  if(event==='TOKEN_REFRESHED'&&session) currentUser=session.user;
  if(event==='SIGNED_OUT'){currentUser=null;}
});

render();
restoreSession();
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));}

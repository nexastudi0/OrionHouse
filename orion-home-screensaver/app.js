const STORAGE_KEY = 'orion_home_items_v1';
const SESSION_KEY = 'orion_home_session_v1';
const ACCESS = {
  home: { user: 'casa', pass: 'orion123' },
  street: { user: 'rua', pass: 'lista123' }
};
let currentMode = null;
let voiceInitialized = false;
let items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
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
  screensaverExit: document.getElementById('screensaverExit')
};

function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); render(); }
function uid(){ return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function cap(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
function notify(msg){ els.toast.textContent = msg; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'),2200); }

function guessCategory(name){
  const n = name.toLowerCase();
  if (/(detergente|sabão|sabao|desinfetante|amaciante|água sanitária|agua sanitaria|esponja|limpador)/.test(n)) return 'Limpeza';
  if (/(shampoo|sabonete|pasta de dente|creme dental|papel higiênico|papel higienico|desodorante)/.test(n)) return 'Higiene';
  if (/(lâmpada|lampada|pilha|parafuso|fita isolante|ferramenta|tomada)/.test(n)) return 'Manutenção';
  if (/(arroz|feijão|feijao|leite|pão|pao|carne|café|cafe|queijo|refrigerante|fruta|verdura|óleo|oleo|açúcar|acucar|sal)/.test(n)) return 'Mercado';
  return 'Outros';
}

function addItem(name, qty=1, category){
  name = name.trim().replace(/[.,;!?]+$/,'');
  if(!name) return;
  items.push({id:uid(), name:cap(name), qty:Number(qty)||1, category:category||guessCategory(name), done:false, createdAt:Date.now()});
  save();
}

function render(){
  const shown = items.filter(i => activeFilter === 'Todos' || i.category === activeFilter).sort((a,b)=> Number(a.done)-Number(b.done) || b.createdAt-a.createdAt);
  els.list.innerHTML = '';
  els.empty.style.display = shown.length ? 'none' : 'block';
  shown.forEach(item=>{
    const row = document.createElement('div'); row.className = 'item'+(item.done?' done':'');
    row.innerHTML = `
      <input class="check" type="checkbox" ${item.done?'checked':''} aria-label="Marcar ${item.name} como comprado">
      <div class="item-main"><div class="item-name">${escapeHtml(item.name)}</div><div class="item-meta">${item.qty}x • ${item.category}</div></div>
      <button class="delete-btn" aria-label="Excluir ${item.name}">Excluir</button>`;
    row.querySelector('.check').addEventListener('change',e=>{item.done=e.target.checked;save();});
    row.querySelector('.delete-btn').addEventListener('click',()=>{items=items.filter(i=>i.id!==item.id);save();notify('Item removido.');});
    els.list.appendChild(row);
  });
  els.total.textContent = items.length;
  els.done.textContent = items.filter(i=>i.done).length;
  els.pending.textContent = items.filter(i=>!i.done).length;
}
function escapeHtml(s){ return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }

els.form.addEventListener('submit',e=>{e.preventDefault();addItem(els.name.value,els.qty.value,els.category.value);els.name.value='';els.qty.value=1;notify('Item adicionado.');els.name.focus();});

document.querySelectorAll('.filter').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(b=>b.classList.remove('active'));btn.classList.add('active');activeFilter=btn.dataset.filter;render();}));

document.getElementById('clearDoneBtn').addEventListener('click',()=>{const before=items.length;items=items.filter(i=>!i.done);save();notify(before===items.length?'Nenhum item comprado.':'Itens comprados removidos.');});
document.getElementById('clearAllBtn').addEventListener('click',()=>{if(!items.length)return notify('A lista já está vazia.');if(confirm('Deseja limpar toda a lista?')){items=[];save();notify('Lista limpa.');}});
document.getElementById('speakListBtn').addEventListener('click',speakPendingList);

function speak(text){
  if(!('speechSynthesis' in window)) return notify('Leitura de voz não disponível neste navegador.');
  speaking = true;
  if(recognition && listening){ try{ recognition.stop(); }catch(_){} }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang='pt-BR'; u.rate=.95;
  u.onend = u.onerror = ()=>{ speaking=false; scheduleRestart(350); };
  speechSynthesis.speak(u);
}
function speakPendingList(){
  const pending = items.filter(i=>!i.done);
  if(!pending.length) return speak('Sua lista está vazia.');
  const text='Ainda faltam: '+pending.map(i=>`${i.qty} ${i.name}`).join(', ')+'.'; speak(text);
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
    if(!micStream){
      micStream = await navigator.mediaDevices.getUserMedia({audio:true});
    }
    return true;
  }catch(err){
    els.heard.textContent='Microfone bloqueado. Libere a permissão do microfone no navegador.';
    notify('Permissão do microfone necessária.');
    return false;
  }
}

async function startRecognition(){
  if(!recognition || !alwaysListening || listening || speaking || recognitionStarting) return;
  recognitionStarting = true;
  const ok = await ensureMicPermission();
  if(!ok){
    alwaysListening=false;
    recognitionStarting=false;
    updateVoiceUI();
    return;
  }
  try{
    recognition.start();
  }catch(err){
    scheduleRestart(700);
  }finally{
    recognitionStarting=false;
  }
}

function scheduleRestart(delay=350){
  clearTimeout(restartTimer);
  if(!alwaysListening || speaking) return;
  const now=Date.now();
  const guard=Math.max(delay, 250-(now-lastRestartAt));
  restartTimer=setTimeout(()=>{
    lastRestartAt=Date.now();
    startRecognition();
  }, guard);
}

function armWakeWindow(){
  waitingForCommand=true;
  clearTimeout(wakeTimer);
  updateVoiceUI();
  els.heard.textContent='Orion ativado. Pode falar o comando.';
  wakeTimer=setTimeout(()=>{
    waitingForCommand=false;
    updateVoiceUI();
    els.heard.textContent='Aguardando você dizer “Orion”...';
  }, 9000);
}

function setupVoice(){
  if(voiceInitialized) return;
  voiceInitialized = true;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!window.isSecureContext && location.hostname!=='localhost'){
    els.heard.textContent='Para o microfone funcionar de forma confiável, abra o Orion em HTTPS (ou localhost), não diretamente pelo arquivo.';
  }
  if(!SR){
    els.voiceBtn.disabled=true;
    els.heard.textContent='Este navegador não oferece reconhecimento de voz. Use Chrome ou Edge em Android/desktop.';
    els.micStatus.textContent='● Voz indisponível';
    return;
  }
  recognition = new SR();
  recognition.lang='pt-BR';
  recognition.interimResults=true;
  // Ciclos curtos são mais estáveis no Chrome/Android; onend reinicia automaticamente.
  recognition.continuous=false;
  recognition.maxAlternatives=3;

  recognition.onstart=()=>{ listening=true; els.heard.textContent=waitingForCommand?'Pode falar o comando.':'Aguardando você dizer “Orion”...'; updateVoiceUI(); };
  recognition.onend=()=>{ listening=false; scheduleRestart(300); };
  recognition.onerror=e=>{
    listening=false;
    if(e.error==='not-allowed' || e.error==='service-not-allowed'){
      alwaysListening=false;
      updateVoiceUI();
      els.heard.textContent='Permita o acesso ao microfone para ativar o Orion.';
      notify('Permita acesso ao microfone.');
      return;
    }
    if(e.error!=='no-speech' && e.error!=='aborted') els.heard.textContent='O microfone reiniciou. Aguardando “Orion”...';
    scheduleRestart(600);
  };
  recognition.onresult=e=>{
    for(let i=e.resultIndex;i<e.results.length;i++){
      const result=e.results[i];
      let transcript='';
      for(let a=0;a<result.length;a++){
        const candidate=result[a].transcript.trim();
        if(/\b[oó]rion\b/i.test(candidate)){ transcript=candidate; break; }
        if(!transcript) transcript=candidate;
      }
      if(!result.isFinal){
        if(transcript) els.heard.textContent=`Ouvindo: “${transcript}”`;
        continue;
      }
      if(transcript) processVoiceTranscript(transcript);
    }
  };
  updateVoiceUI();
}



async function requestWakeLock(){
  if(!('wakeLock' in navigator) || !alwaysListening || currentMode!=='home') return;
  try{
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release',()=>{ wakeLock=null; });
  }catch(_){ wakeLock=null; }
}
function releaseWakeLock(){
  if(wakeLock){ try{ wakeLock.release(); }catch(_){} wakeLock=null; }
}
function enterScreensaver(){
  if(currentMode!=='home') return;
  if(!alwaysListening){ notify('Ative o Orion antes da tela de descanso.'); return; }
  screensaverActive=true;
  els.screensaver.classList.remove('hidden');
  els.screensaver.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  requestWakeLock();
}
function exitScreensaver(){
  screensaverActive=false;
  els.screensaver.classList.add('hidden');
  els.screensaver.setAttribute('aria-hidden','true');
  document.body.style.overflow='';
  releaseWakeLock();
}
els.screensaverBtn.addEventListener('click', enterScreensaver);
els.screensaverExit.addEventListener('click', exitScreensaver);
els.screensaver.addEventListener('dblclick', exitScreensaver);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible' && screensaverActive) requestWakeLock();
});

els.voiceBtn.addEventListener('click',async()=>{
  if(!recognition) return;
  const turningOn=!alwaysListening;
  if(turningOn){
    const ok=await ensureMicPermission();
    if(!ok) return;
  }
  alwaysListening=turningOn;
  waitingForCommand=false;
  clearTimeout(wakeTimer);
  if(alwaysListening){
    els.heard.textContent='Aguardando você dizer “Orion”...';
    updateVoiceUI();
    startRecognition();
  } else {
    clearTimeout(restartTimer);
    try{ recognition.stop(); }catch(_){}
    els.heard.textContent='Orion desativado. Toque em “Ativar Orion” para voltar a ouvir.';
    updateVoiceUI();
  }
});

function processVoiceTranscript(raw){
  const normalized=raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const wakeMatch=normalized.match(/(?:^|\b)orion\b[,:;!?]?\s*(.*)$/i);

  if(wakeMatch){
    const command=(wakeMatch[1]||'').trim();
    if(command){
      waitingForCommand=false;
      clearTimeout(wakeTimer);
      updateVoiceUI();
      els.heard.textContent=`Comando: “${command}”`;
      handleCommand(command);
    } else {
      armWakeWindow();
    }
    return;
  }

  if(waitingForCommand){
    waitingForCommand=false;
    clearTimeout(wakeTimer);
    updateVoiceUI();
    els.heard.textContent=`Comando: “${raw}”`;
    handleCommand(raw);
  }
  // Qualquer fala sem “Orion” é ignorada quando ele não está aguardando um comando.
}

function cleanAddCommand(text){
  return text
    .replace(/^(por favor\s+)?(adiciona|adicione|adicionar|coloca|coloque|colocar|bota|bote|botar|inclui|inclua|incluir|anota|anote|anotar|preciso de|precisamos de|quero|quero comprar)\s+/i,'')
    .replace(/\s+(na|à|a|pra|para)\s+(minha\s+)?lista(?:\s+(do|de)\s+mercado)?\s*$/i,'')
    .replace(/\s+(na|à|a|pra|para)\s+lista\s*$/i,'')
    .replace(/[.!?]+$/,'')
    .trim();
}

function handleCommand(raw){
  let text=raw.toLowerCase().trim().replace(/^orion\b[,:;!?]?\s*/i,'');
  if(/(o que falta|o que ainda falta|ler lista|leia a lista|qual a lista)/.test(text)){speakPendingList();return;}
  if(/(limpar|apagar) (a |minha )?lista/.test(text)){items=[];save();speak('Lista limpa.');notify('Lista limpa por voz.');return;}
  if(/(limpar|apagar|remover) (os )?(comprados|itens comprados)/.test(text)){items=items.filter(i=>!i.done);save();speak('Itens comprados removidos.');return;}

  const removeMatch=text.match(/(?:remover|remove|remova|tirar|tira|apagar|apaga)\s+(.+?)(?:\s+(?:da|de|na)\s+(?:minha\s+)?lista)?$/);
  if(removeMatch){
    const target=removeMatch[1].trim();
    const idx=items.findIndex(i=>i.name.toLowerCase().includes(target));
    if(idx>=0){const [r]=items.splice(idx,1);save();speak(`${r.name} removido da lista.`);}else{speak(`Não encontrei ${target} na lista.`);}return;
  }

  const markMatch=text.match(/(?:marcar|marca|marque)\s+(.+?)\s+(?:como )?(?:comprado|comprada|pego|pega|feito|feita)/);
  if(markMatch){
    const target=markMatch[1].trim();
    const item=items.find(i=>i.name.toLowerCase().includes(target));
    if(item){item.done=true;save();speak(`${item.name} marcado como comprado.`);}else{speak(`Não encontrei ${target}.`);}return;
  }

  text=cleanAddCommand(text);
  if(!text){speak('Não entendi o item.');return;}

  const parts=text.split(/,|\s+e\s+/).map(s=>s.trim()).filter(Boolean);
  const added=[];
  parts.forEach(part=>{
    let qty=1; let name=part;
    const m=part.match(/^(\d+)\s+(.+)$/); if(m){qty=Number(m[1]);name=m[2];}
    name=name.replace(/^(um|uma)\s+/,'').trim();
    if(!name) return;
    addItem(name,qty,guessCategory(name));
    added.push(`${qty>1?qty+' ':''}${name}`);
  });

  if(!added.length){speak('Não entendi o item.');return;}
  speak(`Adicionei ${added.join(', ')} à lista.`);
  notify(added.length===1 ? `${cap(added[0])} adicionado.` : 'Itens adicionados por voz.');
}

render();

let selectedAccessMode = 'home';
function selectAccessMode(mode){
  selectedAccessMode = mode;
  document.querySelectorAll('.access-tab').forEach(btn=>btn.classList.toggle('active', btn.dataset.mode===mode));
  els.loginHint.textContent = mode==='home'
    ? 'Acesso Casa: possui voz e gerenciamento completo.'
    : 'Acesso Rua: somente a lista de compras, sem comando de voz.';
}

document.querySelectorAll('.access-tab').forEach(btn=>btn.addEventListener('click',()=>selectAccessMode(btn.dataset.mode)));

function applyMode(mode){
  currentMode = mode;
  document.body.classList.toggle('street-mode', mode==='street');
  els.loginScreen.classList.add('hidden');
  els.appShell.classList.remove('hidden');
  els.modeSubtitle.textContent = mode==='street'
    ? 'Lista rápida para usar fora de casa.'
    : 'Assistente doméstico para listas e necessidades da casa.';
  if(mode==='street') {
    alwaysListening=false; waitingForCommand=false; speaking=false;
    clearTimeout(restartTimer); clearTimeout(wakeTimer);
    if(recognition && listening){ try{recognition.stop();}catch(_){}}
    els.micStatus.textContent='● Modo Rua';
  } else {
    setupVoice();
    updateVoiceUI();
  }
  render();
}

els.loginForm.addEventListener('submit',e=>{
  e.preventDefault();
  const creds=ACCESS[selectedAccessMode];
  if(els.loginUser.value.trim()===creds.user && els.loginPass.value===creds.pass){
    localStorage.setItem(SESSION_KEY, JSON.stringify({mode:selectedAccessMode}));
    els.loginPass.value='';
    applyMode(selectedAccessMode);
  } else {
    notify('Usuário ou senha incorretos.');
  }
});

els.logoutBtn.addEventListener('click',()=>{
  localStorage.removeItem(SESSION_KEY);
  alwaysListening=false; waitingForCommand=false;
  clearTimeout(restartTimer); clearTimeout(wakeTimer);
  if(recognition && listening){ try{recognition.stop();}catch(_){}}
  exitScreensaver();
  currentMode=null;
  els.appShell.classList.add('hidden');
  els.loginScreen.classList.remove('hidden');
  els.loginUser.value=''; els.loginPass.value='';
  selectAccessMode('home');
});

try{
  const session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
  if(session && (session.mode==='home'||session.mode==='street')) applyMode(session.mode);
}catch(_){}

if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{})); }

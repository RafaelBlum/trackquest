/* ============ CONFIGURAÇÃO ============
   Pode editar aqui OU passar pela URL (a URL tem prioridade). */
const q = new URLSearchParams(location.search);
const saved = (() => { try { return JSON.parse(localStorage.getItem('ra-overlay-cred') || '{}'); } catch (e) { return {}; } })();
const CFG = {
  user:     q.get('user')  || saved.user || 'blumzeira',
  key:      q.get('key')   || saved.key  || 'VPiHkcacXfHr0Z8y47soDcoytSy5WMn9',
  poll:    (+q.get('poll') || 8)  * 1000,   // checa conquistas a cada N s
  time:    (+q.get('time') || 7)  * 1000,   // tempo do alerta na tela
  pos:      q.get('pos')   || 'bl',          // alerta: tl | tr | bl | br
  ppos:     q.get('ppos')  || 'tl',
  opos:     q.get('opos')  || 'tr',          // painel de objetivo: tl | tr | bl | br          // progresso: tl | tr | bl | br
  progress: q.get('progress') !== '0',       // &progress=0 esconde o card
  sound:    q.get('sound') !== '0',          // &sound=0 silencia
  hcOnly:   q.get('hc') === '1',             // &hc=1 só alerta hardcore
  scale:   +q.get('scale') || 1,             // &scale=1.25 aumenta tudo
  demo:     q.get('demo') === '1',
  debug:    q.get('debug') === '1',   // &debug=1 mostra o aviso do som nos testes (T / M / demo)
  vol:     (q.has('vol') ? +q.get('vol') : 0.8),         // &vol=0.5 (0 a 1)
  sfx:      q.get('sfx')       || null,   // caminho do arquivo (senão procura Assets/sound/conquista.ogg/.mp3/.wav)
  sfxMaster:q.get('sfxmaster') || null    // idem para Assets/sound/masterizado.ogg/.mp3/.wav
};
/* ====================================== */

const APP = { name: 'Quest Alert', version: '1.0', year: 2026 };   // aparece no rodapé do menu
const $ = id => document.getElementById(id);
const alertEl = $('alert'), progEl = $('progress'), mastEl = $('mastery'), objEl = $('objective');
alertEl.classList.add(CFG.pos); progEl.classList.add(CFG.ppos); mastEl.classList.add(CFG.pos); objEl.classList.add(CFG.opos);
alertEl.style.setProperty('--s', CFG.scale); progEl.style.setProperty('--s', CFG.scale); mastEl.style.setProperty('--s', CFG.scale); objEl.style.setProperty('--s', CFG.scale);

const seen = new Set();
const queue = [];
let showing = false, firstPoll = true, ctx = null;
let lastGame = { id: null, hc: 0 };
let pendingMastery = null;                 // masterização detectada, esperando as conquistas entrarem na fila
let displayName = CFG.user;                // nome do usuário como está no RA (ex.: Blumzeira)

/* ---------- API ---------- */
async function ra(endpoint, params) {
  const u = new URL(`https://retroachievements.org/API/${endpoint}.php`);
  u.search = new URLSearchParams({ z: CFG.user, y: CFG.key, ...params });
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const setStatus = t => { $('status').textContent = t; };
const media = p => 'https://media.retroachievements.org' + p;

/* ---------- conquistas ---------- */
async function pollAchievements() {
  try {
    // "m" = janela em MINUTOS. Todas as conquistas da janela vêm de uma vez.
    const list = await ra('API_GetUserRecentAchievements', { u: CFG.user, m: 30 });
    setStatus('');
    const fresh = [];
    for (const a of list) {
      const k = a.AchievementID + '-' + a.HardcoreMode; // soft e hard são eventos distintos
      if (!seen.has(k)) { seen.add(k); fresh.push(a); }
    }
    if (firstPoll) { firstPoll = false; return; } // não dispara as antigas
    fresh.sort((a, b) => a.Date.localeCompare(b.Date)).forEach(enqueue);
    fresh.forEach(a => objDone(String(a.GameID), String(a.AchievementID), a.Title));   // objetivo conquistado
    if (pendingMastery) { enqueue(pendingMastery); pendingMastery = null; }   // sempre DEPOIS dos alertas de conquista
    if (fresh.length) setTimeout(pollProgress, 3000);
  } catch (e) {
    setStatus(CFG.key.startsWith('SUA_') ? 'Preencha user e key do RetroAchievements' : 'Erro na API do RA: ' + e.message);
  }
}

function enqueue(a) {
  if (CFG.hcOnly && !a.special && !+a.HardcoreMode) return;
  queue.push(a); next();
}

let editing = false;
function next() {
  if (editing || showing || !queue.length) return;
  showing = true;
  const a = queue.shift();
  if (a.special) return showMastery(a);
  fill(a);

  const t = $('timer');
  t.style.transition = 'none'; t.style.width = '100%'; void t.offsetWidth;
  t.style.transition = `width ${CFG.time}ms linear`; t.style.width = '0%';

  chime(a.special, a.test);
  alertEl.classList.add('show');
  setTimeout(() => {
    alertEl.classList.remove('show');
    setTimeout(() => { showing = false; next(); }, 800);
  }, CFG.time);
}

/* ---------- banner de masterização ---------- */
function fmtSpan(ms) {
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mi = m % 60;
  return (d ? d + 'd ' : '') + h + 'h ' + String(mi).padStart(2, '0') + 'min';
}

function masteryLine(a) {
  if (a.manualTime) return `${displayName} | Tempo de execução: ${a.manualTime}`;   // só no exemplo da tecla M
  if (a.spanMs > 60000) return `${displayName} | Tempo até masterizar: ${fmtSpan(a.spanMs)}`;
  return displayName;
}

function syncPos(el) {
  el.dataset.bd = alertEl.dataset.bd;                     // o banner usa a mesma posição e tamanho do alerta
  ['tl', 'tr', 'bl', 'br'].forEach(c => el.classList.toggle(c, alertEl.classList.contains(c)));
  ['left', 'top', 'right', 'bottom', 'transformOrigin'].forEach(p => { el.style[p] = alertEl.style[p]; });
  el.style.setProperty('--s', alertEl.style.getPropertyValue('--s'));
  el.style.setProperty('--from', alertEl.style.getPropertyValue('--from'));
}

function showMastery(a) {
  syncPos(mastEl);
  $('m-img').src = media(a.IconPath);
  $('m-title').textContent = a.Title + ' dominado';
  $('m-sub').textContent = masteryLine(a);
  chime(true, a.test);
  mastEl.classList.add('show');
  setTimeout(() => {
    mastEl.classList.remove('show');
    setTimeout(() => { showing = false; next(); }, 800);
  }, CFG.time + 3000);
}

function fill(a) {
  const color = a.special ? 'var(--master)' : (+a.HardcoreMode ? 'var(--hc)' : 'var(--sc)');
  alertEl.style.setProperty('--c', color);
  $('hdr').textContent = a.special ? 'Jogo masterizado!' : 'Conquista desbloqueada';
  $('mode').textContent = a.special ? 'Mastery' : (+a.HardcoreMode ? 'Hardcore' : 'Softcore');
  $('badge').src = a.special ? media(a.IconPath) : media(`/Badge/${a.BadgeName}.png`);
  $('title').textContent = a.Title;
  $('desc').textContent = a.Description;
  $('game').textContent = a.GameTitle || '';
  $('pts').textContent = a.special ? '★' : '+' + a.Points;
}

/* ---------- progresso do jogo atual ---------- */
async function pollProgress() {
  if (!CFG.progress) return;
  try {
    const p = await ra('API_GetUserProfile', { u: CFG.user });
    displayName = p.User || CFG.user;
    if (!p.LastGameID) return;
    const g = await ra('API_GetGameInfoAndUserProgress', { g: p.LastGameID, u: CFG.user });
    renderProgress(g, p.RichPresenceMsg);
  } catch (e) { /* o card simplesmente não atualiza */ }
}

let lastSig = null;
function pulse() {
  progEl.classList.remove('pulse'); void progEl.offsetWidth; progEl.classList.add('pulse');
}
progEl.addEventListener('animationend', e => { if (e.target === progEl) progEl.classList.remove('pulse'); });

function renderProgress(g, presence) {
  curGame = g;
  const total = +g.NumAchievements || 0;
  const any = +g.NumAwardedToUser || 0, hc = +g.NumAwardedToUserHardcore || 0;
  $('gicon').src = media(g.ImageIcon);
  $('gtitle').textContent = g.Title;
  $('gstate').textContent = presence || g.ConsoleName || '';
  $('bsoft').style.width = total ? (any / total * 100) + '%' : '0';
  $('bhard').style.width = total ? (hc / total * 100) + '%' : '0';
  $('pnum').textContent = any; $('ptot').textContent = ` / ${total} conquistas`;
  $('ppct').textContent = total ? Math.round(any / total * 100) + '%' : '';
  progEl.classList.add('ready');
  const sig = `${g.ID}|${any}|${hc}|${presence}`;
  if (lastSig !== null && sig !== lastSig) pulse();   // algo mudou: o card pisca suave
  lastSig = sig;

  // masterização: mesmo jogo, hardcore acabou de chegar em 100%
  if (total && hc === total && lastGame.id === g.ID && lastGame.hc < total) {
    // intervalo entre a 1ª e a última conquista hardcore (usado se você não digitar o tempo de execução)
    const ds = Object.values(g.Achievements || {})
      .map(x => Date.parse((x.DateEarnedHardcore || '').replace(' ', 'T') + 'Z')).filter(n => !isNaN(n));
    pendingMastery = { special: true, Title: g.Title, IconPath: g.ImageIcon, HardcoreMode: 1,
                       spanMs: ds.length ? Math.max(...ds) - Math.min(...ds) : 0 };
    pollAchievements();   // garante que a última conquista entre na fila antes do banner
  }
  lastGame = { id: g.ID, hc };
  checkObjectives(); renderObjective();
}

/* ---------- som retrô (sem arquivo externo) ---------- */
function say(t) {                       // aviso na tela: só com &debug=1
  if (!CFG.debug || editing) return;
  $('hint').textContent = t;
  clearTimeout(say.t); say.t = setTimeout(() => { if (!editing) $('hint').textContent = ''; }, 5000);
}

const SND_DIR = 'Assets/sound/';                  // pasta dos sons, a partir do HTML
const upl = { ach: null, master: null };           // sons enviados pelo menu (guardados no IndexedDB)
const nameOf = src => src.startsWith('blob:') ? 'arquivo enviado' : src;

function sfxList(special) {
  const custom = special ? CFG.sfxMaster : CFG.sfx;
  const base = special ? 'masterizado' : 'conquista';
  const files = custom ? [custom] : [SND_DIR + base + '.ogg', SND_DIR + base + '.mp3', SND_DIR + base + '.wav'];
  const up = upl[special ? 'master' : 'ach'];
  return up ? [up.url, ...files] : files;
}

function chime(special, report) {
  if (!CFG.sound) return;
  const list = sfxList(special);
  const tryNext = i => {
    if (i >= list.length) {
      if (report) say(`Arquivo ${special ? 'masterizado' : 'conquista'} (.ogg/.mp3/.wav) não encontrado → som retrô`);
      return beep(special);
    }
    const a = new Audio(list[i]);
    a.volume = Math.min(1, Math.max(0, CFG.vol));
    let moved = false;
    const fail = () => { if (!moved) { moved = true; tryNext(i + 1); } };
    a.addEventListener('error', fail, { once: true });
    a.play().then(() => { if (report) say(`Tocando: ${nameOf(list[i])} ✓`); })
            .catch(err => {
              if (err && err.name === 'NotAllowedError') { if (report) say('O navegador bloqueou o som: clique na página e tente de novo'); return; }
              fail();
            });
  };
  tryNext(0);
}

function beep(special) {
  try {
    ctx = ctx || new AudioContext();
    const notes = special ? [523, 659, 784, 1047, 1319] : [659, 831, 988, 1319];
    const t0 = ctx.currentTime;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + i * 0.09;
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.3);
    });
  } catch (e) {}
}

/* ---------- modo demo ---------- */
const demoSamples = [
  { AchievementID: 101, Title: 'Mestre das Plataformas', Description: 'Termine a fase 3 sem perder nenhuma vida.', Points: 25, BadgeName: '00001', GameTitle: 'Super Mario World', HardcoreMode: 1 },
  { AchievementID: 102, Title: 'Colecionador', Description: 'Pegue todas as moedas da fase da floresta.', Points: 10, BadgeName: '00002', GameTitle: 'Donkey Kong Country 2', HardcoreMode: 0 }
];
let demoI = 0;
function demo() {
  renderProgress({ ID: 0, Title: 'Super Mario World', ConsoleName: 'SNES', ImageIcon: '/Images/000001.png',
    NumAchievements: 57, NumAwardedToUser: 21, NumAwardedToUserHardcore: 14, NumDistinctPlayers: 2000,
    Achievements: {
      101: { ID: 101, Title: 'Mestre das Plataformas', Description: 'Termine a fase 3 sem perder nenhuma vida.', Points: 25, BadgeName: '00001', NumAwarded: 300, DisplayOrder: 1 },
      102: { ID: 102, Title: 'Colecionador', Description: 'Pegue todas as moedas da fase da floresta.', Points: 10, BadgeName: '00002', NumAwarded: 1200, DisplayOrder: 2 },
      103: { ID: 103, Title: 'Velocista', Description: 'Complete o mundo 1 em menos de 5 minutos.', Points: 15, BadgeName: '00003', NumAwarded: 150, DisplayOrder: 3 },
      104: { ID: 104, Title: 'Sem Pressa', Description: 'Encontre todas as saídas secretas do jogo.', Points: 50, BadgeName: '00004', NumAwarded: 40, DisplayOrder: 4 },
      105: { ID: 105, Title: 'Primeiros Passos', Description: 'Termine a primeira fase.', Points: 5, BadgeName: '00005', NumAwarded: 1900, DisplayOrder: 5, DateEarned: '2026-01-01 10:00:00' }
    } }, 'Mundo 2 · Vidas: 5');
  const fire = () => enqueue({ ...demoSamples[demoI++ % demoSamples.length], test: true });
  fire(); setInterval(fire, CFG.time + 3000); setInterval(pulse, 7000);
}
window.testAlert = () => {
  const s = { ...demoSamples[demoI++ % demoSamples.length], test: true };
  enqueue(s);
  if (curGame && s.AchievementID) objDone(String(curGame.ID), String(s.AchievementID), s.Title);   // testa o "Concluída!" do objetivo
};
window.testMastery = () => enqueue({ special: true, test: true, Title: 'Classic NES Series: Super Mario Bros.',
  IconPath: '/Images/000001.png', HardcoreMode: 1, manualTime: '12:16:51' });
addEventListener('keydown', e => {
  if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 't') window.testAlert();
  if (k === 'm') window.testMastery();
});

/* ---------- modo edição: arrastar e redimensionar (botão "Interagir" do OBS) ---------- */
const loadLayout = () => { try { return JSON.parse(localStorage.getItem('ra-overlay-layout') || '{}'); } catch (e) { return {}; } };
const saveLayout = () => { try { localStorage.setItem('ra-overlay-layout', JSON.stringify(layout)); } catch (e) {} };
const layout = loadLayout();
if (q.has('ax')) layout.alert = { x: +q.get('ax'), y: +q.get('ay'), s: +q.get('as') || CFG.scale };
if (q.has('px')) layout.prog  = { x: +q.get('px'), y: +q.get('py'), s: +q.get('ps') || CFG.scale };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const getS = el => parseFloat(el.style.getPropertyValue('--s')) || CFG.scale;

function place(el, p) {
  el.classList.remove('tl', 'tr', 'bl', 'br');
  el.style.right = el.style.bottom = 'auto';
  el.style.transformOrigin = 'top left';
  el.style.left = p.x + 'px';
  el.style.top  = p.y + 'px';
  el.style.setProperty('--s', p.s || CFG.scale);
  if (p.w) el.style.width = p.w + 'px';
  const w = el.getBoundingClientRect().width;
  el.style.setProperty('--from', p.x + w / 2 < innerWidth / 2 ? '-130%' : '130%');
}
if (layout.alert) place(alertEl, layout.alert);
if (layout.prog)  place(progEl, layout.prog);
if (layout.obj)   place(objEl, layout.obj);

// passa o painel para posição por esquerda/topo antes de mexer nele
function anchor(el, name) {
  const r = el.getBoundingClientRect();
  layout[name] = { x: r.left, y: r.top, s: getS(el), w: (layout[name] || {}).w };
  place(el, layout[name]);
}

/* efeitos escolhidos no modo edição (guardados junto com a posição) */
const BORDERS = [['default','Padrão'],['none','Sem borda'],['square','Cantos retos'],['round','Arredondada']];
const SHOW = [['on','Visível'],['off','Escondido']];
const SIZES = [['s','Pequena'],['n','Normal'],['l','Grande'],['xl','Enorme']];
const FX = [
  { key: 'in',     el: alertEl, attr: 'in',    group: 'Alerta', label: 'Entrada', param: 'ain',
    opts: [['slide','Deslizar'],['zoom','Zoom'],['drop','Cair'],['flip','Girar'],['fade','Surgir']] },
  { key: 'shine',  el: alertEl, attr: 'shine', group: 'Alerta', label: 'Brilho',  param: 'ashine',
    opts: [['sweep','Reflexo'],['pulse','Pulsar'],['none','Nenhum']] },
  { key: 'abd',    el: alertEl, attr: 'bd',    group: 'Alerta', label: 'Borda',   param: 'abd', opts: BORDERS },
  { key: 'pshow',  el: progEl,  attr: 'on',    group: 'Painel de dados', label: 'Exibir painel', param: 'pon', opts: SHOW },
  { key: 'theme',  el: progEl,  attr: 'theme', group: 'Painel de dados', label: 'Cores', param: 'ptheme',
    opts: [['neon','Neon'],['fogo','Fogo'],['verde','Verde'],['rosa','Rosa'],['escuro','Escuro']] },
  { key: 'light',  el: progEl,  attr: 'light', group: 'Painel de dados', label: 'Luz do ícone', param: 'plight',
    opts: [['orbit','Circulando'],['pulse','Pulsando'],['none','Parada']] },
  { key: 'blink',  el: progEl,  attr: 'blink', group: 'Painel de dados', label: 'Piscada ao atualizar', param: 'pblink',
    opts: [['soft','Suave'],['strong','Forte'],['none','Nenhuma']] },
  { key: 'pbd',    el: progEl,  attr: 'bd',    group: 'Painel de dados', label: 'Borda', param: 'pbd', opts: BORDERS },
  { key: 'obj',    el: objEl,   attr: 'on',    group: 'Objetivo', label: 'Exibir painel', param: 'oobj', opts: SHOW },
  { key: 'ostyle', el: objEl,   attr: 'style', group: 'Objetivo', label: 'Estilo', param: 'ostyle',
    opts: [['glass','Translúcido'],['solid','Escuro sólido'],['light','Claro'],['neon','Neon'],['minimal','Minimalista']] },
  { key: 'obd',    el: objEl,   attr: 'bd',    group: 'Objetivo', label: 'Borda', param: 'obd', opts: BORDERS },
  { key: 'fl',     el: objEl,   attr: 'fl',    group: 'Objetivo', label: 'Fonte do rótulo', param: 'ofl', opts: SIZES, def: 'n' },
  { key: 'ft',     el: objEl,   attr: 'ft',    group: 'Objetivo', label: 'Fonte do título', param: 'oft', opts: SIZES, def: 'n' },
  { key: 'fd',     el: objEl,   attr: 'fd',    group: 'Objetivo', label: 'Fonte da descrição e dados', param: 'ofd', opts: SIZES, def: 'n' }
];
layout.fx = layout.fx || {};
layout.txt = layout.txt || {};
const TXT = { olabel: ['o-lab', 'Objetivo atual'], odone: ['o-done', '✓ Concluída!'] };
function applyTxt() { Object.keys(TXT).forEach(k => { const v = layout.txt[k]; $(TXT[k][0]).textContent = v == null ? TXT[k][1] : v; }); }
applyTxt();
FX.forEach(o => {
  const v = q.get(o.param) || layout.fx[o.key];
  o.cur = o.opts.some(x => x[0] === v) ? v : (o.def || o.opts[0][0]);
  o.el.dataset[o.attr] = o.cur;
});

function replayAlert() {                  // mostra de novo o alerta para ver o efeito
  alertEl.classList.remove('show');
  setTimeout(() => { if (editing) alertEl.classList.add('show'); }, 800);
}

function updateHint() {
  const f = (k, p) => p ? `&${k}x=${Math.round(p.x)}&${k}y=${Math.round(p.y)}&${k}s=${(p.s || 1).toFixed(2)}` : '';
  const fx = FX.map(o => o.cur !== (o.def || o.opts[0][0]) ? `&${o.param}=${o.cur}` : '').join('');
  console.log('[RA Overlay] parâmetros de URL equivalentes:', f('a', layout.alert) + f('p', layout.prog) + fx);
}
$('bar-foot').textContent = `${APP.name} · v${APP.version} · ${APP.year}`;

/* ---------- janela de configurações: abas, estilos prontos e botões gerados de uma tabela (leve) ---------- */
const TABS = ['Alerta', 'Painel de dados', 'Objetivo', 'Sons e conta'];
const PRESETS = [
  { name: 'Arcade',      set: { in: 'slide', shine: 'sweep', abd: 'default', pshow: 'on', theme: 'neon',   light: 'orbit', blink: 'soft', pbd: 'default', ostyle: 'glass',   obd: 'default' } },
  { name: 'Clean',       set: { in: 'fade',  shine: 'none',  abd: 'round',   pshow: 'on', theme: 'escuro', light: 'none',  blink: 'soft', pbd: 'round',   ostyle: 'glass',   obd: 'round' } },
  { name: 'Minimalista', set: { in: 'fade',  shine: 'none',  abd: 'none',    pshow: 'on', theme: 'escuro', light: 'none',  blink: 'none', pbd: 'none',    ostyle: 'minimal', obd: 'none' } }
];
let stTab = TABS[0];

function applyFx(o, v) { o.cur = v; o.el.dataset[o.attr] = v; layout.fx[o.key] = v; }

function renderSettings() {
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; if (tag === 'button') e.type = 'button'; return e; };
  const pre = $('st-presets'); pre.textContent = '';
  pre.appendChild(mk('span', '', 'Estilos prontos:'));
  PRESETS.forEach(p => {
    const b = mk('button', 'pill', p.name);
    b.addEventListener('click', () => {
      FX.forEach(o => { if (p.set[o.key]) applyFx(o, p.set[o.key]); });
      saveLayout(); replayAlert(); pulse(); renderSettings();
    });
    pre.appendChild(b);
  });
  const tabs = $('st-tabs'); tabs.textContent = '';
  TABS.forEach(t => {
    const b = mk('button', 'pill' + (t === stTab ? ' on' : ''), t);
    b.addEventListener('click', () => { stTab = t; renderSettings(); });
    tabs.appendChild(b);
  });
  const conta = stTab === 'Sons e conta', body = $('st-body');
  body.textContent = ''; body.style.display = conta ? 'none' : '';
  $('st-conta').classList.toggle('on', conta);
  if (conta) return;
  FX.filter(o => o.group === stTab).forEach(o => {
    const row = mk('div', 'st-row'), pills = mk('div', 'st-pills');
    row.appendChild(mk('span', 'st-lab', o.label));
    o.opts.forEach(([v, name]) => {
      const b = mk('button', 'pill' + (o.cur === v ? ' on' : ''), name);
      b.addEventListener('click', () => {
        applyFx(o, v); saveLayout();
        if (o.group === 'Alerta') replayAlert(); else if (o.key === 'blink') pulse();
        renderSettings();
      });
      pills.appendChild(b);
    });
    row.appendChild(pills); body.appendChild(row);
  });
  if (stTab === 'Objetivo') {                                  // textos do painel de objetivo
    [['olabel', 'Texto do rótulo'], ['odone', 'Texto ao concluir']].forEach(([k, lab]) => {
      const row = mk('div', 'st-row'), inp = document.createElement('input');
      inp.type = 'text'; inp.maxLength = 30; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.value = layout.txt[k] == null ? TXT[k][1] : layout.txt[k];
      inp.addEventListener('input', () => { layout.txt[k] = inp.value; applyTxt(); saveLayout(); });
      row.append(mk('span', 'st-lab', lab), inp); body.appendChild(row);
    });
  }
}
$('st-open').addEventListener('click', () => { $('picker').classList.remove('on'); $('settings').classList.toggle('on'); renderSettings(); });
$('st-close').addEventListener('click', () => $('settings').classList.remove('on'));

function toggleEdit() {
  editing = !editing;
  document.body.classList.toggle('editing', editing);
  if (editing) {
    $('intro').classList.remove('on');
    fill(demoSamples[0]);
    renderObjective(); updateObjInfo();
    const t = $('timer'); t.style.transition = 'none'; t.style.width = '100%';
    alertEl.classList.add('show');
    if (!$('gtitle').textContent) {
      $('gtitle').textContent = 'Nome do jogo'; $('gstate').textContent = 'Rich presence';
      $('bsoft').style.width = '40%'; $('bhard').style.width = '25%';
      $('pnum').textContent = '0'; $('ptot').textContent = ' / 0 conquistas';
    }
    progEl.classList.add('ready'); progEl.classList.remove('dim');
    updateHint();
  } else {
    alertEl.classList.remove('show');
    if ($('gtitle').textContent === 'Nome do jogo') { progEl.classList.remove('ready'); $('gtitle').textContent = ''; }
    $('hint').textContent = '';
    $('picker').classList.remove('on'); $('settings').classList.remove('on');
    showing = false; next(); renderObjective();
  }
}

[[alertEl, 'alert'], [progEl, 'prog'], [objEl, 'obj']].forEach(([el, name]) => {
  const handle = document.createElement('div'); handle.className = 'rh'; el.appendChild(handle);    // tamanho (escala)
  const wHandle = document.createElement('div'); wHandle.className = 'rw'; el.appendChild(wHandle); // só a largura

  el.addEventListener('pointerdown', e => {
    if (!editing) return;
    e.preventDefault();
    const mode = e.target === handle ? 'resize' : e.target === wHandle ? 'width' : 'drag';
    anchor(el, name);
    const r = el.getBoundingClientRect(), s0 = getS(el);
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = ev => {
      if (mode === 'drag') {
        layout[name].x = clamp(ev.clientX - dx, 0, innerWidth - r.width);
        layout[name].y = clamp(ev.clientY - dy, 0, innerHeight - r.height);
      } else if (mode === 'width') {
        layout[name].w = Math.round(clamp((ev.clientX - r.left) / s0, 240, 1400));   // largura sem esticar o conteúdo
      } else {
        layout[name].s = clamp(s0 * (ev.clientX - r.left) / r.width, 0.4, 3);
      }
      place(el, layout[name]); updateHint();
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      saveLayout();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });

  el.addEventListener('wheel', e => {
    if (!editing) return;
    e.preventDefault();
    anchor(el, name);
    layout[name].s = clamp(getS(el) * (e.deltaY < 0 ? 1.05 : 0.95), 0.4, 3);
    place(el, layout[name]); updateHint(); saveLayout();
  }, { passive: false });
});

addEventListener('keydown', e => {
  if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'e') toggleEdit();
  if (k === 'r' && editing) { try { localStorage.removeItem('ra-overlay-layout'); } catch (err) {} location.reload(); }
});

/* ---------- upload dos sons pelo menu (modo edição) ---------- */
const idb = (() => {
  let dbp;
  const open = () => dbp = dbp || new Promise((res, rej) => {
    const r = indexedDB.open('ra-overlay', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('sfx');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction('sfx', mode), rq = fn(t.objectStore('sfx'));
    t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error);
  }));
  return { get: k => tx('readonly', st => st.get(k)), set: (k, v) => tx('readwrite', st => st.put(v, k)),
           del: k => tx('readwrite', st => st.delete(k)) };
})();

function setUpl(key, v) {
  if (upl[key]) URL.revokeObjectURL(upl[key].url);
  upl[key] = { name: v.name, url: URL.createObjectURL(v.blob) };
}
function clearUpl(key) { if (upl[key]) URL.revokeObjectURL(upl[key].url); upl[key] = null; }

(() => {
  const box = $('bar-snd');
  const chip = t => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = t; return b; };
  [['ach', 'Som da conquista', false], ['master', 'Som da masterização', true]].forEach(([key, title, special]) => {
    const row = document.createElement('div'); row.className = 'snd-row';
    const t = document.createElement('span'); t.textContent = title + ':';
    const pick = chip('Escolher arquivo'), test = chip('▶ Testar'), del = chip('Remover');
    const nm = document.createElement('span'); nm.className = 'snd-name';
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'audio/*,.ogg,.mp3,.wav,.m4a'; inp.style.display = 'none';
    const refresh = () => {
      nm.textContent = upl[key] ? 'enviado: ' + upl[key].name : 'usando o arquivo da pasta';
      del.style.display = upl[key] ? '' : 'none';
    };
    pick.addEventListener('click', () => inp.click());
    test.addEventListener('click', () => chime(special, false));
    del.addEventListener('click', () => { idb.del(key).catch(() => {}); clearUpl(key); refresh(); });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; inp.value = '';
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) { nm.textContent = 'Arquivo grande demais (máximo 10 MB)'; return; }
      if (!/^audio\//.test(f.type) && !/\.(ogg|mp3|wav|m4a)$/i.test(f.name)) { nm.textContent = 'Use um arquivo de som (.ogg, .mp3, .wav)'; return; }
      try {
        await idb.set(key, { name: f.name, blob: f });
        setUpl(key, { name: f.name, blob: f }); refresh(); chime(special, false);
      } catch (e) { nm.textContent = 'Não foi possível salvar o som neste navegador'; }
    });
    row.append(t, pick, test, del, nm, inp); box.appendChild(row);
    idb.get(key).then(v => { if (v && v.blob) setUpl(key, v); refresh(); }).catch(refresh);
  });
})();

/* ---------- painel de objetivo: a conquista que estamos tentando fazer ---------- */
const OBJ_KEY = 'ra-overlay-obj';                      // { idDoJogo: [idsDasConquistas na ordem da fila] }
let curGame = null, objFlash = false, objFlashT = null, pkSort = 0;
const objSeen = new Set();                             // objetivos vistos "ainda não ganhos" (para o efeito Concluída!)
const SORTS = ['Ordem do jogo', 'Mais pontos', 'Mais raras'];
const SAMPLE_OBJ = { Title: 'Nome da conquista', Description: 'Aqui aparece a descrição do objetivo atual.', Points: 10, BadgeName: '00000' };

const objStore = () => { try { return JSON.parse(localStorage.getItem(OBJ_KEY) || '{}'); } catch (e) { return {}; } };
const objSave = s => { try { localStorage.setItem(OBJ_KEY, JSON.stringify(s)); } catch (e) {} };
const objQueue = () => (curGame && objStore()[String(curGame.ID)]) || [];
const setObjQueue = ids => {
  const s = objStore(), k = String(curGame.ID);
  if (ids.length) s[k] = ids; else delete s[k];
  objSave(s);
};
const ach = id => curGame && curGame.Achievements && curGame.Achievements[id];
const isEarned = a => !!(a.DateEarned || a.DateEarnedHardcore);
const rarity = a => {
  const players = curGame && (curGame.NumDistinctPlayers || curGame.NumDistinctPlayersCasual);
  return players && a.NumAwarded != null ? (a.NumAwarded / players * 100).toFixed(1) + '% dos jogadores' : '';
};

function fillObjective(a, n) {
  const img = $('o-badge'); img.dataset.fb = '';
  img.onerror = () => { if (!img.dataset.fb) { img.dataset.fb = '1'; img.src = media(`/Badge/${a.BadgeName}.png`); } };
  img.src = media(`/Badge/${a.BadgeName}_lock.png`);       // versão "bloqueada" (cinza)
  $('o-title').textContent = a.Title;
  $('o-desc').textContent = a.Description;
  $('o-pts').textContent = a.Points + ' pts';
  $('o-rar').textContent = rarity(a);
  $('o-queue').textContent = n > 1 ? `+${n - 1} na fila` : '';
}

function renderObjective() {
  if (objFlash) { objEl.classList.add('show', 'done'); return; }      // mostra "Concluída!" sobre o conteúdo anterior
  objEl.classList.remove('done');
  const ids = objQueue();
  const a = ids.map(ach).find(x => x && !isEarned(x));
  if (a) { fillObjective(a, ids.length); objEl.classList.add('show'); }
  else if (editing) { fillObjective(SAMPLE_OBJ, 1); objEl.classList.add('show'); }   // exemplo para posicionar o painel
  else objEl.classList.remove('show');
  updateObjInfo();
}

// tira o objetivo da fila; se era o primeiro, mostra "Concluída!" e depois avança para o próximo
function objDone(gameId, id, title, silent) {
  const s = objStore(), q = s[gameId] || [];
  if (!q.includes(id)) return;
  const rest = q.filter(x => x !== id);
  if (rest.length) s[gameId] = rest; else delete s[gameId];
  objSave(s);
  if (!curGame || String(curGame.ID) !== String(gameId)) return;
  if (!silent && q[0] === id) {
    objFlash = true;
    clearTimeout(objFlashT);
    objFlashT = setTimeout(() => { objFlash = false; renderObjective(); }, 4500);
  }
  renderObjective();
  if ($('picker').classList.contains('on')) renderPicker();
}

function checkObjectives() {
  if (!curGame) return;
  const gid = String(curGame.ID);
  (objStore()[gid] || []).forEach(id => {
    const a = ach(id); if (!a) return;
    const key = gid + ':' + id;
    if (!isEarned(a)) objSeen.add(key);
    else objDone(gid, id, a.Title, !objSeen.has(key));    // já ganha antes de abrir o overlay: sai da fila sem efeito
  });
}

function updateObjInfo() {
  $('obj-info').textContent = curGame ? `${curGame.Title} · fila: ${objQueue().length}`
                                      : 'Abra um jogo no emulador para listar as conquistas';
}

/* lista para escolher os objetivos */
function renderPicker() {
  const list = $('pk-list'); list.textContent = '';
  $('pk-sort').textContent = 'Ordenar: ' + SORTS[pkSort];
  const msg = t => { const d = document.createElement('div'); d.className = 'pk-empty'; d.textContent = t; list.appendChild(d); };
  if (!curGame) { $('pk-title').textContent = 'Escolher objetivo'; return msg('Nenhum jogo lido ainda. Abra um jogo no emulador e espere alguns segundos.'); }
  const gid = String(curGame.ID), ids = objQueue();
  let items = Object.values(curGame.Achievements || {}).filter(a => !isEarned(a));
  $('pk-title').textContent = `${curGame.Title} · ${items.length} pendentes`;
  const f = $('pk-search').value.trim().toLowerCase();
  if (f) items = items.filter(a => (a.Title + ' ' + a.Description).toLowerCase().includes(f));
  items.sort(pkSort === 1 ? (a, b) => b.Points - a.Points
           : pkSort === 2 ? (a, b) => (a.NumAwarded == null ? 1e9 : a.NumAwarded) - (b.NumAwarded == null ? 1e9 : b.NumAwarded)
           : (a, b) => (a.DisplayOrder || 0) - (b.DisplayOrder || 0));
  if (!items.length) return msg(f ? 'Nenhuma conquista encontrada.' : 'Nenhuma conquista pendente neste jogo.');
  items.forEach(a => {
    const id = String(a.ID), pos = ids.indexOf(id);
    const row = document.createElement('div'); row.className = 'pk-item' + (pos >= 0 ? ' sel' : '');
    const n = document.createElement('div'); n.className = 'pk-n'; n.textContent = pos >= 0 ? '#' + (pos + 1) : '';
    const img = document.createElement('img'); img.src = media(`/Badge/${a.BadgeName}_lock.png`); img.alt = '';
    const tx = document.createElement('div'); tx.className = 'pk-tx';
    const t = document.createElement('div'); t.className = 'pk-t'; t.textContent = a.Title;
    const d = document.createElement('div'); d.className = 'pk-d'; d.textContent = a.Description;
    tx.append(t, d);
    const m = document.createElement('div'); m.className = 'pk-m'; m.textContent = a.Points + ' pts';
    const r = rarity(a); if (r) { const sm = document.createElement('small'); sm.textContent = r; m.appendChild(sm); }
    row.append(n, img, tx, m);
    row.addEventListener('click', () => {
      const cur = objQueue();
      if (cur.includes(id)) setObjQueue(cur.filter(x => x !== id));
      else { setObjQueue([...cur, id]); objSeen.add(gid + ':' + id); }
      renderObjective(); renderPicker();
    });
    list.appendChild(row);
  });
}

$('obj-open').addEventListener('click', () => { $('settings').classList.remove('on'); $('picker').classList.add('on'); renderPicker(); });
$('pk-close').addEventListener('click', () => $('picker').classList.remove('on'));
$('pk-search').addEventListener('input', renderPicker);
$('pk-sort').addEventListener('click', () => { pkSort = (pkSort + 1) % SORTS.length; renderPicker(); });
$('pk-clear').addEventListener('click', () => { if (curGame) { setObjQueue([]); renderObjective(); renderPicker(); } });

/* ---------- campos de usuário e API Key (modo edição) ---------- */
(() => {
  const u = $('in-user'), k = $('in-key'), msg = $('cred-msg');
  u.value = CFG.user; k.value = CFG.key;
  const note = (t, ok) => { msg.textContent = t; msg.style.color = ok ? '#7dffb2' : '#ff8a8a'; };
  async function save() {
    const user = u.value.trim(), key = k.value.trim();
    if (!user || !key) return note('Preencha usuário e API Key', false);
    note('Conectando…', true);
    const prev = { user: CFG.user, key: CFG.key };
    CFG.user = user; CFG.key = key;
    try {
      const p = await ra('API_GetUserProfile', { u: user });
      if (!p || !(p.User || p.ID)) throw new Error('usuário não encontrado');
      try { localStorage.setItem('ra-overlay-cred', JSON.stringify({ user, key })); } catch (e) {}
      displayName = p.User || user;
      note('✓ Conectado como ' + displayName, true);
      seen.clear(); firstPoll = true; lastSig = null; lastGame = { id: null, hc: 0 }; pendingMastery = null;
      setStatus(''); pollAchievements(); pollProgress();
    } catch (e) {
      CFG.user = prev.user; CFG.key = prev.key;
      note('✗ ' + (/401|403/.test(e.message) ? 'Usuário ou API Key inválidos' : e.message), false);
    }
  }
  $('cred-save').addEventListener('click', save);
  [u, k].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') save(); }));
})();

/* ---------- aviso do Interagir: só chega mouse na página quando a janela Interagir está aberta ---------- */
const intro = $('intro'); let introTimer;
function hideIntro() { clearTimeout(introTimer); intro.classList.remove('on'); }
function showIntro() {
  if (editing) return;
  const bar = $('bar');                          // mesmo tamanho do menu de edição
  intro.style.width = bar.offsetWidth + 'px';
  intro.style.minHeight = bar.offsetHeight + 'px';
  intro.classList.add('on');
  clearTimeout(introTimer); introTimer = setTimeout(hideIntro, 8000);
}
addEventListener('pointermove', showIntro);
addEventListener('pointerdown', showIntro);
document.documentElement.addEventListener('mouseleave', hideIntro);

/* ---------- início ---------- */
if (CFG.demo) demo();
else {
  pollAchievements(); setInterval(pollAchievements, CFG.poll);
  pollProgress();     setInterval(pollProgress, 60000);
}

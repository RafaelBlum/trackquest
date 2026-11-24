/* ============ CONFIGURAÇÃO ============
   Pode editar aqui OU passar pela URL (a URL tem prioridade). */
const q = new URLSearchParams(location.search);
const saved = (() => { try { return JSON.parse(localStorage.getItem('ra-overlay-cred') || '{}'); } catch (e) { return {}; } })();
const CFG = {
  user:     q.get('user')  || saved.user || 'User',
  key:      q.get('key')   || saved.key  || 'API key sua',
  poll:    (+q.get('poll') || 8)  * 1000,   // checa conquistas a cada N s
  time:    (+q.get('time') || 7)  * 1000,   // tempo do alerta na tela
  pos:      q.get('pos')   || 'bl',          // alerta: tl | tr | bl | br
  ppos:     q.get('ppos')  || 'tl',
  gpos:     q.get('gpos')  || 'br',          // painel de conquistas: tl | tr | bl | br
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

const APP = { name: 'TrackQuest', version: '1.2', year: 2026 };   // aparece no rodapé do menu
const $ = id => document.getElementById(id);
const alertEl = $('alert'), progEl = $('progress'), mastEl = $('mastery'), objEl = $('objective'), gridEl = $('grid'), bubEl = $('bubbles');
alertEl.classList.add(CFG.pos); progEl.classList.add(CFG.ppos); mastEl.classList.add(CFG.pos); objEl.classList.add(CFG.opos); gridEl.classList.add(CFG.gpos);
alertEl.style.setProperty('--s', CFG.scale); progEl.style.setProperty('--s', CFG.scale); mastEl.style.setProperty('--s', CFG.scale); objEl.style.setProperty('--s', CFG.scale); gridEl.style.setProperty('--s', CFG.scale);

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
    fresh.forEach(a => { if (curGame && String(a.GameID) === String(curGame.ID)) gridUnlock(a.AchievementID); });
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

/* ---------- tempo jogado gravado pelo RA ---------- */
let lastPlay = null;
function fmtPlay(sec, withSec) {
  sec = Math.max(0, Math.floor(+sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60, p = n => String(n).padStart(2, '0');
  return (withSec || progEl.dataset.tfmt === 'hms') ? `${h}:${p(m)}:${p(s)}` : `${h}:${p(m)}`;
}
function updateTime() { $('gtime').textContent = lastPlay == null ? '' : fmtPlay(lastPlay); }

/* ---------- banner de masterização ---------- */
function fmtSpan(ms) {
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mi = m % 60;
  return (d ? d + 'd ' : '') + h + 'h ' + String(mi).padStart(2, '0') + 'min';
}

function masteryLine(a) {
  if (a.manualTime) return `${displayName} | Tempo de execução: ${a.manualTime}`;   // só no exemplo da tecla M
  if (a.playSec > 0) return `${displayName} | Tempo de execução: ${fmtPlay(a.playSec, true)}`;   // tempo gravado pelo RA
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
  burst();
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
  lastPlay = g.UserTotalPlaytime == null ? null : g.UserTotalPlaytime; updateTime();
  progEl.classList.add('ready');
  const sig = `${g.ID}|${any}|${hc}|${presence}`;
  if (lastSig !== null && sig !== lastSig) pulse();   // algo mudou: o card pisca suave
  lastSig = sig;

  // masterização: mesmo jogo, hardcore acabou de chegar em 100%
  if (total && hc === total && lastGame.id === g.ID && lastGame.hc < total) {
    // intervalo entre a 1ª e a última conquista hardcore (usado se você não digitar o tempo de execução)
    const ds = Object.values(g.Achievements || {})
      .map(x => Date.parse((x.DateEarnedHardcore || '').replace(' ', 'T') + 'Z')).filter(n => !isNaN(n));
    pendingMastery = { special: true, Title: g.Title, IconPath: g.ImageIcon, HardcoreMode: 1, playSec: +g.UserTotalPlaytime || 0,
                       spanMs: ds.length ? Math.max(...ds) - Math.min(...ds) : 0 };
    pollAchievements();   // garante que a última conquista entre na fila antes do banner
  }
  lastGame = { id: g.ID, hc };
  checkObjectives(); renderObjective(); renderGrid();
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
  const ach0 = {}, names = [['Mestre das Plataformas', 'Termine a fase 3 sem perder nenhuma vida.', 25], ['Colecionador', 'Pegue todas as moedas da fase da floresta.', 10],
    ['Velocista', 'Complete o mundo 1 em menos de 5 minutos.', 15], ['Sem Pressa', 'Encontre todas as saídas secretas do jogo.', 50]];
  for (let i = 0; i < 30; i++) {
    const id = 101 + i, n = names[i] || ['Conquista ' + (i + 1), 'Descrição da conquista ' + (i + 1) + '.', 5 + i];
    ach0[id] = { ID: id, Title: n[0], Description: n[1], Points: n[2], BadgeName: String(i + 1).padStart(5, '0'), NumAwarded: 100 + i * 40, DisplayOrder: i + 1 };
    if (i >= 4 && i % 3 === 0) ach0[id].DateEarned = '2026-01-01 10:00:00';
  }
  renderProgress({ ID: 0, Title: 'Super Mario World', ConsoleName: 'SNES', ImageIcon: '/Images/000001.png',
    NumAchievements: 57, NumAwardedToUser: 21, NumAwardedToUserHardcore: 14, NumDistinctPlayers: 2000,
    Achievements: ach0, UserTotalPlaytime: 504867 }, 'Mundo 2 · Vidas: 5');
  const fire = () => enqueue({ ...demoSamples[demoI++ % demoSamples.length], test: true });
  fire(); setInterval(fire, CFG.time + 3000); setInterval(pulse, 7000);
}
window.testAlert = () => {
  const s = { ...demoSamples[demoI++ % demoSamples.length], test: true };
  enqueue(s);
  if (curGame && s.AchievementID) { objDone(String(curGame.ID), String(s.AchievementID), s.Title); gridUnlock(s.AchievementID); }   // testa objetivo e cabeçada
};
window.testGrid = () => {                   // libera a próxima conquista bloqueada do painel (teste)
  const a = curGame && Object.values(curGame.Achievements || {}).find(x => { const c = gridCells.get(String(x.ID)); return c && !c.classList.contains('on') && !gridPending.has(String(x.ID)); });
  if (a) gridUnlock(a.ID);
};
window.testMastery = () => enqueue({ special: true, test: true, Title: 'Classic NES Series: Super Mario Bros.',
  IconPath: '/Images/000001.png', HardcoreMode: 1, manualTime: '12:16:51' });
addEventListener('keydown', e => {
  if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 't') window.testAlert();
  if (k === 'm') window.testMastery();
  if (k === 'g') window.testGrid();
  if (k === 'b') burst(true);
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
if (layout.grid)  place(gridEl, layout.grid);

// passa o painel para posição por esquerda/topo antes de mexer nele
function anchor(el, name) {
  const r = el.getBoundingClientRect();
  layout[name] = { x: r.left, y: r.top, s: getS(el), w: (layout[name] || {}).w };
  place(el, layout[name]);
}

/* ---------- opções: uma tabela só; cada item diz em qual menu e seção aparece ---------- */
const BORDERS = [['default','Padrão'],['none','Sem borda'],['square','Cantos retos'],['round','Arredondada']];
const SHOW = [['on','Visível'],['off','Escondido']];
const ONOFF = [['on','Ligada'],['off','Desligada']];
const FXE = [['none','Nenhum'],['neon','Neon'],['pulse','Pulsar'],['spin','Luz circulando']];
const FXC = [['ciano','Ciano'],['rosa','Rosa'],['verde','Verde'],['dourado','Dourado'],['vermelho','Vermelho'],['branco','Branco']];
const LANGS = [['orig','Original (inglês)'],['pt-BR','Português'],['es','Español'],['fr','Français'],['de','Deutsch'],['it','Italiano']];
const THEMES = [['neon','Neon'],['fogo','Fogo'],['verde','Verde'],['rosa','Rosa'],['escuro','Escuro']];

const FX = [
  // ----- Alerta
  { key: 'in',    el: alertEl, attr: 'in',    win: 'alert', sec: 'Entrada e brilho', label: 'Entrada', param: 'ain',
    opts: [['slide','Deslizar'],['zoom','Zoom'],['drop','Cair'],['flip','Girar'],['fade','Surgir']] },
  { key: 'shine', el: alertEl, attr: 'shine', win: 'alert', sec: 'Entrada e brilho', label: 'Brilho', param: 'ashine',
    opts: [['sweep','Reflexo'],['pulse','Pulsar'],['none','Nenhum']] },
  { key: 'abd',   el: alertEl, attr: 'bd',    win: 'alert', sec: 'Estilo', label: 'Borda', param: 'abd', opts: BORDERS },
  // ----- Painel de dados
  { key: 'pshow', el: progEl, attr: 'on',   win: 'prog', sec: 'Elementos', label: 'Exibir painel', param: 'pon', opts: SHOW },
  { key: 'ptime', el: progEl, attr: 'time', win: 'prog', sec: 'Elementos', label: 'Tempo jogado', param: 'ptime', opts: [['on','Mostrar'],['off','Esconder']] },
  { key: 'ptfmt', el: progEl, attr: 'tfmt', win: 'prog', sec: 'Elementos', label: 'Formato do tempo', param: 'ptfmt', opts: [['hm','H:MM'],['hms','H:MM:SS']], after: () => updateTime() },
  { key: 'theme', el: progEl, attr: 'theme', win: 'prog', sec: 'Estilo', label: 'Cores', param: 'ptheme', opts: THEMES },
  { key: 'light', el: progEl, attr: 'light', win: 'prog', sec: 'Estilo', label: 'Luz do ícone', param: 'plight', opts: [['orbit','Circulando'],['pulse','Pulsando'],['none','Parada']] },
  { key: 'blink', el: progEl, attr: 'blink', win: 'prog', sec: 'Estilo', label: 'Piscada ao atualizar', param: 'pblink', opts: [['soft','Suave'],['strong','Forte'],['none','Nenhuma']] },
  { key: 'pbd',   el: progEl, attr: 'bd',    win: 'prog', sec: 'Estilo', label: 'Borda', param: 'pbd', opts: BORDERS },
  { key: 'pfx',   el: progEl, attr: 'fx',    win: 'prog', sec: 'Efeito de borda', label: 'Efeito', param: 'pfx', opts: FXE },
  { key: 'pfxc',  el: progEl, attr: 'fxc',   win: 'prog', sec: 'Efeito de borda', label: 'Cor do efeito', param: 'pfxc', opts: FXC },
  // ----- Objetivo
  { key: 'obj',    el: objEl, attr: 'on',     win: 'obj', sec: 'Elementos', label: 'Exibir painel', param: 'oobj', opts: SHOW },
  { key: 'olang',  el: objEl, attr: 'lang',   win: 'obj', sec: 'Tradução', label: 'Idioma da conquista', param: 'olang', opts: LANGS, after: () => renderObjective() },
  { key: 'ostyle', el: objEl, attr: 'style',  win: 'obj', sec: 'Painel', label: 'Estilo', param: 'ostyle',
    opts: [['glass','Translúcido'],['solid','Escuro sólido'],['light','Claro'],['neon','Neon'],['minimal','Minimalista']] },
  { key: 'obd',    el: objEl, attr: 'bd',     win: 'obj', sec: 'Painel', label: 'Borda', param: 'obd', opts: BORDERS },
  { key: 'ofx',    el: objEl, attr: 'fx',     win: 'obj', sec: 'Efeito de borda', label: 'Efeito', param: 'ofx', opts: FXE },
  { key: 'ofxc',   el: objEl, attr: 'fxc',    win: 'obj', sec: 'Efeito de borda', label: 'Cor do efeito', param: 'ofxc', opts: FXC },
  { key: 'oscroll',el: objEl, attr: 'scroll', win: 'obj', sec: 'Faixa de texto', label: 'Rolagem do texto', param: 'oscroll',
    opts: [['auto','Automática'],['always','Sempre'],['off','Desligada']], after: () => layoutStrip() },
  { key: 'osb',    el: objEl, attr: 'sb',     win: 'obj', sec: 'Faixa de texto', label: 'Fundo da faixa', param: 'osb',
    opts: [['glass','Translúcido'],['dark','Escuro'],['fire','Fogo'],['blue','Azul'],['green','Verde'],['purple','Roxo'],['custom','Personalizado']] },
  // ----- Painel de conquistas
  { key: 'gshow',  el: gridEl, attr: 'on',     win: 'grid', sec: 'Elementos', label: 'Exibir painel', param: 'gon', opts: SHOW, def: 'off', after: () => renderGrid() },
  { key: 'ghead',  el: gridEl, attr: 'ghead',  win: 'grid', sec: 'Elementos', label: 'Título do painel', param: 'ghead', opts: [['off','Esconder'],['on','Mostrar']] },
  { key: 'gan',    el: gridEl, attr: 'gan',    win: 'grid', sec: 'Elementos', label: 'Animação da cabeçada', param: 'gan', opts: ONOFF },
  { key: 'glock',  el: gridEl, attr: 'glock',  win: 'grid', sec: 'Badges', label: 'Bloqueadas', param: 'glock', opts: [['blur','Blur'],['gray','Cinza'],['dark','Escurecidas'],['none','Sem efeito']] },
  { key: 'gfilter',el: gridEl, attr: 'gfilter',win: 'grid', sec: 'Badges', label: 'Mostrar', param: 'gfilter', opts: [['all','Todas'],['locked','Só bloqueadas'],['unlocked','Só ganhas']], after: () => renderGrid() },
  { key: 'gsort',  el: gridEl, attr: 'gsort',  win: 'grid', sec: 'Badges', label: 'Ordem', param: 'gsort', opts: [['game','Do jogo'],['points','Mais pontos'],['rare','Mais raras']], after: () => renderGrid() },
  { key: 'gbg',    el: gridEl, attr: 'gbg',    win: 'grid', sec: 'Painel', label: 'Fundo', param: 'gbg', opts: [['glass','Translúcido'],['solid','Escuro'],['none','Sem fundo']] },
  { key: 'gbd',    el: gridEl, attr: 'bd',     win: 'grid', sec: 'Painel', label: 'Borda', param: 'gbd', opts: BORDERS },
  { key: 'gfx',    el: gridEl, attr: 'fx',     win: 'grid', sec: 'Efeito de borda', label: 'Efeito', param: 'gfx', opts: FXE },
  { key: 'gfxc',   el: gridEl, attr: 'fxc',    win: 'grid', sec: 'Efeito de borda', label: 'Cor do efeito', param: 'gfxc', opts: FXC },
  { key: 'gbs',    el: gridEl, attr: 'gbs',    win: 'grid', sec: 'Borda dos badges', label: 'Borda', param: 'gbs',
    opts: [['normal','Normal'],['none','Sem borda'],['thin','Fina'],['thick','Grossa'],['neon','Neon']] },
  { key: 'gbc',    el: gridEl, attr: 'gbc',    win: 'grid', sec: 'Borda dos badges', label: 'Cor (ganhas)', param: 'gbc', opts: [['dourado','Dourado'],...FXC.filter(x => x[0] !== 'dourado')] },
  { key: 'gbr',    el: gridEl, attr: 'gbr',    win: 'grid', sec: 'Borda dos badges', label: 'Cantos', param: 'gbr', opts: [['soft','Suaves'],['sq','Retos'],['round','Arredondados']] },
  // ----- Bolinhas (masterização)
  { key: 'bon',    el: bubEl, attr: 'on',   win: 'bub', sec: 'Efeito', label: 'Bolinhas ao masterizar', param: 'bon', opts: [['on','Ligado'],['off','Desligado']] },
  { key: 'bgrav',  el: bubEl, attr: 'grav', win: 'bub', sec: 'Efeito', label: 'Gravidade', param: 'bgrav', opts: [['off','Nenhuma'],['soft','Leve'],['hard','Forte']] },
  { key: 'bbd',    el: bubEl, attr: 'bd',   win: 'bub', sec: 'Bolinhas', label: 'Borda', param: 'bbd', opts: [['thin','Fina'],['none','Sem borda'],['thick','Grossa'],['neon','Neon']] },
  { key: 'bbc',    el: bubEl, attr: 'bc',   win: 'bub', sec: 'Bolinhas', label: 'Cor da borda', param: 'bbc', opts: FXC }
];
const BTNS = [   // botões de ação dentro dos menus
  { win: 'obj', sec: 'Fila de objetivos', label: () => curGame ? `${curGame.Title} · fila: ${objQueue().length}` : 'Abra um jogo no emulador para listar as conquistas',
    btn: 'Escolher objetivo', fn: () => { $('picker').classList.add('on'); renderPicker(); } },
  { win: 'bub', sec: 'Teste', label: 'Soltar as bolinhas agora (tecla B)', btn: 'Testar efeito', fn: () => burst(true) }
];

const objAfter = () => { layoutStrip(); fitBadge(); };
const NUMS = [   // tamanhos em px (css = variável CSS que recebe o valor)
  { key: 'olpx', el: objEl, css: '--olpx', win: 'obj', sec: 'Fontes (px)', label: 'Texto da faixa (rótulo)', def: 16, min: 8, max: 72, step: 1, after: objAfter },
  { key: 'otpx', el: objEl, css: '--otpx', win: 'obj', sec: 'Fontes (px)', label: 'Título', def: 18, min: 10, max: 96, step: 1, after: objAfter },
  { key: 'ospx', el: objEl, css: '--ospx', win: 'obj', sec: 'Fontes (px)', label: 'Descrição', def: 14, min: 10, max: 120, step: 1, after: objAfter },
  { key: 'ompx', el: objEl, css: '--ompx', win: 'obj', sec: 'Fontes (px)', label: 'Pontos e raridade', def: 12, min: 8, max: 48, step: 1, after: objAfter },
  { key: 'ospd', el: objEl, css: '--ospd', unit: '', win: 'obj', sec: 'Faixa de texto', label: 'Velocidade da rolagem (px/s)', def: 60, min: 10, max: 400, step: 10, after: objAfter },
  { key: 'gsz',  el: gridEl, css: '--gsz',  win: 'grid', sec: 'Badges', label: 'Tamanho do badge (px)', def: 56, min: 24, max: 160, step: 4 },
  { key: 'ggap', el: gridEl, css: '--ggap', win: 'grid', sec: 'Badges', label: 'Espaço entre badges (px)', def: 6, min: 0, max: 30, step: 1 },
  { key: 'gmax', el: gridEl, css: '--gmax', win: 'grid', sec: 'Painel', label: 'Altura máxima (px)', def: 560, min: 120, max: 1000, step: 20 },
  { key: 'bcount', el: bubEl, win: 'bub', sec: 'Bolinhas', label: 'Quantidade de bolinhas', def: 40, min: 4, max: 150, step: 5 },
  { key: 'bsize',  el: bubEl, win: 'bub', sec: 'Bolinhas', label: 'Tamanho (px)', def: 64, min: 24, max: 160, step: 4 },
  { key: 'bdur',   el: bubEl, win: 'bub', sec: 'Efeito', label: 'Duração (segundos)', def: 10, min: 3, max: 60, step: 1 },
  { key: 'bspd',   el: bubEl, win: 'bub', sec: 'Efeito', label: 'Velocidade (px/s)', def: 380, min: 100, max: 1200, step: 20 },
  { key: 'ui', el: document.documentElement, css: '--ui', map: v => v / 100, win: 'geral', sec: 'Tamanho do menu', label: 'Tamanho do menu (%)', def: 100, min: 60, max: 220, step: 10 }
];

const TXTS = [   // textos e cores digitados (target = elemento que recebe o texto; css = variável de cor)
  { key: 'olabel', win: 'obj', sec: 'Textos', label: 'Texto do rótulo', def: 'Objetivo atual', max: 30, target: 'o-lab' },
  { key: 'odone',  win: 'obj', sec: 'Textos', label: 'Texto ao concluir', def: '✓ Concluída!', max: 30, target: 'o-done' },
  { key: 'ocA', win: 'obj', sec: 'Faixa personalizada', label: 'Cor inicial (#hex)', def: '#1e3a8a', max: 7, css: '--ca', el: objEl },
  { key: 'ocB', win: 'obj', sec: 'Faixa personalizada', label: 'Cor final (#hex)', def: '#38bdf8', max: 7, css: '--cb', el: objEl },
  { key: 'ocT', win: 'obj', sec: 'Faixa personalizada', label: 'Cor do texto (#hex)', def: '#ffffff', max: 7, css: '--ct', el: objEl }
];

layout.fx = layout.fx || {}; layout.num = layout.num || {}; layout.txt = layout.txt || {}; layout.win = layout.win || {};
FX.forEach(o => {
  const v = q.get(o.param) || layout.fx[o.key];
  o.cur = o.opts.some(x => x[0] === v) ? v : (o.def || o.opts[0][0]);
  o.el.dataset[o.attr] = o.cur;
});
const applyNum = n => { if (n.css) n.el.style.setProperty(n.css, n.map ? n.map(n.cur) : n.cur + (n.unit == null ? 'px' : n.unit)); };
const numVal = k => NUMS.find(n => n.key === k).cur;
NUMS.forEach(n => { const v = layout.num[n.key]; n.cur = v != null && !isNaN(+v) ? +v : n.def; applyNum(n); });
const txtOf = t => layout.txt[t.key] == null ? t.def : layout.txt[t.key];
function applyTxt() {
  TXTS.forEach(t => {
    const v = txtOf(t);
    if (t.target) $(t.target).textContent = v;
    else if (/^#[0-9a-f]{6}$/i.test(v)) t.el.style.setProperty(t.css, v);
  });
  layoutStrip();
}
applyTxt();
function applyFx(o, v) { o.cur = v; o.el.dataset[o.attr] = v; layout.fx[o.key] = v; }

function replayAlert() {                  // mostra de novo o alerta para ver o efeito
  alertEl.classList.remove('show');
  setTimeout(() => { if (editing) alertEl.classList.add('show'); }, 800);
}

function updateHint() {
  const f = (k, p) => p ? `&${k}x=${Math.round(p.x)}&${k}y=${Math.round(p.y)}&${k}s=${(p.s || 1).toFixed(2)}` : '';
  const fx = FX.map(o => o.cur !== (o.def || o.opts[0][0]) ? `&${o.param}=${o.cur}` : '').join('');
  console.log('[TrackQuest] parâmetros de URL equivalentes:', f('a', layout.alert) + f('p', layout.prog) + fx);
}
$('bar-foot').textContent = `${APP.name} · v${APP.version} · ${APP.year}`;

/* ---------- menu em abas dentro da barra: abre para baixo ---------- */
const TABS = [['geral','Geral'],['alert','Alerta'],['prog','Painel de dados'],['obj','Objetivo'],['grid','Conquistas'],['bub','Bolinhas']];
const PRESETS = [
  { name: 'Arcade',      set: { in: 'slide', shine: 'sweep', abd: 'default', theme: 'neon',   light: 'orbit', blink: 'soft', pbd: 'default', pfx: 'none', ostyle: 'glass',   obd: 'default', ofx: 'none', osb: 'glass' } },
  { name: 'Clean',       set: { in: 'fade',  shine: 'none',  abd: 'round',   theme: 'escuro', light: 'none',  blink: 'soft', pbd: 'round',   pfx: 'none', ostyle: 'glass',   obd: 'round',   ofx: 'none', osb: 'glass' } },
  { name: 'Minimalista', set: { in: 'fade',  shine: 'none',  abd: 'none',    theme: 'escuro', light: 'none',  blink: 'none', pbd: 'none',    pfx: 'none', ostyle: 'minimal', obd: 'none',    ofx: 'none', osb: 'glass' } },
  { name: 'Neon',        set: { in: 'zoom',  shine: 'pulse', abd: 'round',   theme: 'neon',   light: 'orbit', blink: 'strong', pbd: 'round', pfx: 'neon', ostyle: 'neon',    obd: 'round',   ofx: 'spin', osb: 'dark' } }
];
const barEl = $('bar'), bPanel = $('b-panel');
const sndBox = $('bar-snd'), credRow = $('cred-row');            // guardados agora: ao limpar o painel eles saem do documento
let curTab = null;
const mkEl = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; if (tag === 'button') e.type = 'button'; return e; };

function afterChange(o) {
  if (o.win === 'alert') replayAlert(); else if (o.key === 'blink') pulse();
  if (o.after) o.after();
}

function rowFor(o, win) {
  const row = mkEl('div', 'w-row'); row.appendChild(mkEl('span', 'w-lab', typeof o.label === 'function' ? o.label() : o.label));
  if (o.btn) {                                                    // botão de ação
    const b = mkEl('button', 'wchip', o.btn); b.addEventListener('click', o.fn); row.appendChild(b);
  } else if (o.opts) {                                            // escolha: botões com ✓ no selecionado
    const box = mkEl('div', 'w-opts');
    o.opts.forEach(([v, name]) => {
      const b = mkEl('button', 'wchip' + (o.cur === v ? ' on' : ''), name);
      b.addEventListener('click', () => { applyFx(o, v); saveLayout(); afterChange(o); renderWin(win); });
      box.appendChild(b);
    });
    row.appendChild(box);
  } else if (o.min != null) {                                     // número: − valor +
    const box = mkEl('div', 'w-num'), inp = document.createElement('input');
    inp.type = 'text'; inp.value = o.cur; inp.autocomplete = 'off';
    const set = v => {
      v = Math.round(clamp(+v || o.def, o.min, o.max)); o.cur = v; layout.num[o.key] = v;
      applyNum(o); saveLayout(); if (o.after) o.after(); renderWin(win);
    };
    const minus = mkEl('button', 'wchip', '−'), plus = mkEl('button', 'wchip', '+');
    minus.addEventListener('click', () => set(o.cur - o.step));
    plus.addEventListener('click', () => set(o.cur + o.step));
    inp.addEventListener('change', () => set(inp.value));
    box.append(minus, inp, plus); row.appendChild(box);
  } else {                                                        // texto
    const inp = document.createElement('input');
    inp.type = 'text'; inp.maxLength = o.max || 40; inp.autocomplete = 'off'; inp.spellcheck = false; inp.value = txtOf(o);
    inp.addEventListener('input', () => { layout.txt[o.key] = inp.value; applyTxt(); saveLayout(); });
    row.appendChild(inp);
  }
  return row;
}

function renderWin(key) {
  bPanel.textContent = '';
  const sec = name => { const s = mkEl('div', 'w-sec'); s.appendChild(mkEl('span', 'w-tag', name)); bPanel.appendChild(s); return s; };
  if (key === 'geral') {
    const r = mkEl('div', 'w-opts');
    PRESETS.forEach(p => {
      const b = mkEl('button', 'wchip', p.name);
      b.addEventListener('click', () => {
        FX.forEach(o => { if (p.set[o.key]) applyFx(o, p.set[o.key]); });
        saveLayout(); replayAlert(); pulse(); FX.forEach(o => { if (o.after) o.after(); }); renderWin(key);
      });
      r.appendChild(b);
    });
    sec('Estilos prontos').appendChild(r);
  }
  const items = [...FX, ...NUMS, ...TXTS, ...BTNS].filter(o => o.win === key), names = [];
  items.forEach(o => { if (!names.includes(o.sec)) names.push(o.sec); });
  names.forEach(n => { const s = sec(n); items.filter(o => o.sec === n).forEach(o => s.appendChild(rowFor(o, key))); });
  if (key === 'geral') { sec('Sons').appendChild(sndBox); sec('Conta RetroAchievements').appendChild(credRow); }
  if (key === 'grid') sec('Personagem').appendChild(mkEl('div', 'w-note',
    'O personagem que dá a cabeçada é o arquivo Assets/img/runner.png. Para trocar, coloque outra imagem (PNG, de preferência pixel art virada para a direita, uns 44 px de largura) com esse mesmo nome.'));
  if (key === 'bub') sec('Como funciona').appendChild(mkEl('div', 'w-note',
    'Quando o jogo é masterizado, as badges das conquistas dele saem em bolinhas que quicam pela tela. Se o jogo tem poucas conquistas, as imagens se repetem até completar a quantidade escolhida.'));
}

function setTab(key) {
  curTab = key; barEl.dataset.tab = key || '';
  document.querySelectorAll('#b-tabs .chip').forEach(b => b.classList.toggle('on', b.dataset.tab === key));
  if (key) renderWin(key); else bPanel.textContent = '';
}
function closeWins() { setTab(null); }
TABS.forEach(([k, name]) => {
  const b = mkEl('button', 'chip', name); b.dataset.tab = k;
  b.addEventListener('click', () => setTab(curTab === k ? null : k));
  $('b-tabs').appendChild(b);
});
barEl.dataset.tab = '';

/* o menu também pode ser arrastado (pela área de ajuda) */
function placeBar(p) {
  barEl.style.left = p.x + 'px'; barEl.style.top = p.y + 'px';
  barEl.style.transformOrigin = 'top left'; barEl.style.transform = 'scale(calc(1.54 * var(--ui, 1)))';
}
if (layout.bar) placeBar(layout.bar);
$('b-drag').addEventListener('pointerdown', e => {
  if (!editing) return;
  e.preventDefault();
  const r = barEl.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
  const move = ev => { layout.bar = { x: clamp(ev.clientX - dx, 0, innerWidth - 120), y: clamp(ev.clientY - dy, 0, innerHeight - 60) }; placeBar(layout.bar); };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); saveLayout(); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});

/* ---------- ímã: o painel gruda nas bordas da tela e nos outros painéis ---------- */
const PANELS = [[alertEl, 'alert'], [progEl, 'prog'], [objEl, 'obj'], [gridEl, 'grid']];
function snapPos(name, x, y, w, h, off) {
  if (off) return { x, y };
  const T = 14, G = 8, xs = [0, innerWidth - w], ys = [0, innerHeight - h];
  PANELS.forEach(([el, n]) => {
    if (n === name || getComputedStyle(el).display === 'none') return;
    const o = el.getBoundingClientRect(); if (!o.width) return;
    xs.push(o.right + G, o.left - w - G, o.left, o.right - w);
    ys.push(o.bottom + G, o.top - h - G, o.top, o.bottom - h);
  });
  const best = (v, arr) => arr.reduce((b, c) => Math.abs(c - v) < Math.abs(b - v) ? c : b, arr[0]);
  const nx = best(x, xs), ny = best(y, ys);
  return { x: Math.abs(nx - x) <= T ? nx : x, y: Math.abs(ny - y) <= T ? ny : y };
}

function toggleEdit() {
  editing = !editing;
  document.body.classList.toggle('editing', editing);
  if (editing) {
    $('intro').classList.remove('on');
    fill(demoSamples[0]);
    renderObjective(); updateObjInfo(); renderGrid();
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
    $('picker').classList.remove('on'); closeWins();
    showing = false; next(); renderObjective(); renderGrid();
  }
}

PANELS.forEach(([el, name]) => {
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
        const s = snapPos(name, ev.clientX - dx, ev.clientY - dy, r.width, r.height, ev.altKey);   // Alt solta o ímã
        layout[name].x = clamp(s.x, 0, innerWidth - r.width);
        layout[name].y = clamp(s.y, 0, innerHeight - r.height);
      } else if (mode === 'width') {
        layout[name].w = Math.round(clamp((ev.clientX - r.left) / s0, 240, 1400));   // largura sem esticar o conteúdo
      } else {
        layout[name].s = clamp(s0 * (ev.clientX - r.left) / r.width, 0.4, 3);
      }
      place(el, layout[name]); updateHint(); if (name === 'obj') { layoutStrip(); fitBadge(); }
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

/* tradução automática (serviço gratuito MyMemory; o resultado fica guardado para não repetir) */
const TR_KEY = 'ra-overlay-tr', trBusy = new Set();
let trCache = {};
try { trCache = JSON.parse(localStorage.getItem(TR_KEY) || '{}'); } catch (e) {}
function tr(text) {
  const lang = objEl.dataset.lang;
  if (!text || !lang || lang === 'orig') return text;
  const k = lang + '|' + text;
  if (trCache[k]) return trCache[k];
  if (!trBusy.has(k) && text.length <= 480 && typeof fetch === 'function') {
    trBusy.add(k);
    fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=en|' + lang)
      .then(r => r.json())
      .then(j => {
        const t = j && j.responseData && j.responseData.translatedText;
        if (t && +j.responseStatus === 200 && !/MYMEMORY WARNING/i.test(t)) {
          const ta = document.createElement('textarea'); ta.innerHTML = t; trCache[k] = ta.value;
          try { localStorage.setItem(TR_KEY, JSON.stringify(trCache)); } catch (e) {}
          renderObjective();
        }
      })
      .catch(() => {})
      .then(() => trBusy.delete(k));
  }
  return text;                                   // enquanto não chega a tradução, mostra o original
}

function layoutStrip() {                         // faixa de cima: o texto editável rola quando não cabe
  const strip = objEl.querySelector('.o-strip'), track = $('o-track'), d = $('o-lab');
  track.classList.remove('scroll'); track.style.removeProperty('--shift');
  const dup = track.querySelector('.dup'); if (dup) dup.remove();
  strip.style.display = d.textContent.trim() ? '' : 'none';
  const mode = objEl.dataset.scroll || 'auto';
  if (mode === 'off' || !d.textContent.trim()) return;
  if (mode === 'always' || d.offsetWidth > strip.clientWidth - 32) {
    const c = d.cloneNode(true); c.removeAttribute('id'); c.className = 'dup'; track.appendChild(c);
    const shift = d.offsetWidth + 80, speed = (NUMS.find(n => n.key === 'ospd') || { cur: 60 }).cur || 60;
    track.style.setProperty('--shift', shift + 'px'); track.style.setProperty('--dur', (shift / speed) + 's');
    track.classList.add('scroll');
  }
}

function fitBadge() {                            // a imagem ocupa a altura do bloco título + descrição + pontos
  const h = Math.max(60, Math.round(objEl.querySelector('.o-body').offsetHeight));
  $('o-badge').style.width = $('o-badge').style.height = h + 'px';
}

function fillObjective(a, n) {
  const img = $('o-badge'); img.dataset.fb = '';
  img.onerror = () => { if (!img.dataset.fb) { img.dataset.fb = '1'; img.src = media(`/Badge/${a.BadgeName}.png`); } };
  img.src = media(`/Badge/${a.BadgeName}_lock.png`);       // versão "bloqueada" (cinza)
  const T = a === SAMPLE_OBJ ? (x => x) : tr;                   // o exemplo do modo edição não é traduzido
  $('o-title').textContent = T(a.Title);
  $('o-desc').textContent = T(a.Description);
  $('o-pts').textContent = a.Points + ' pts';
  $('o-rar').textContent = rarity(a);
  $('o-queue').textContent = n > 1 ? `+${n - 1} na fila` : '';
  layoutStrip(); fitBadge();
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

function updateObjInfo() {}                    // (a informação da fila agora aparece na aba Objetivo)

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

$('pk-close').addEventListener('click', () => $('picker').classList.remove('on'));
$('pk-search').addEventListener('input', renderPicker);
$('pk-sort').addEventListener('click', () => { pkSort = (pkSort + 1) % SORTS.length; renderPicker(); });
$('pk-clear').addEventListener('click', () => { if (curGame) { setObjQueue([]); renderObjective(); renderPicker(); } });

/* ---------- painel de conquistas: grade de badges; a que sai do bloqueio leva uma cabeçada ---------- */
const gridCells = new Map(), gridSeen = new Set(), gridPending = new Set(), gridQ = [];
let gridSig = null, gridBusy = false;
const runnerEl = $('runner');
runnerEl.src = 'Assets/img/runner.png';
runnerEl.addEventListener('error', () => { runnerEl.style.visibility = 'hidden'; });

function applyGridFilter() {
  const f = gridEl.dataset.gfilter || 'all';
  gridCells.forEach(c => c.classList.toggle('hide', (f === 'locked' && c.classList.contains('on')) || (f === 'unlocked' && !c.classList.contains('on'))));
  const on = [...gridCells.values()].filter(c => c.classList.contains('on')).length;
  $('g-count').textContent = `${on} / ${gridCells.size}`;
}

function renderGrid() {
  const box = $('g-cells');
  if (gridEl.dataset.on === 'off') return;
  const list = curGame ? Object.values(curGame.Achievements || {}) : [];
  if (!list.length) {                                   // sem jogo: no modo edição mostra quadrados de exemplo
    gridSig = null; gridCells.clear(); box.textContent = '';
    if (editing) {
      for (let i = 0; i < 18; i++) box.appendChild(mkEl('div', 'g-cell' + (i % 4 === 0 ? ' on' : '')));
      $('g-title').textContent = 'Nome do jogo'; $('g-count').textContent = '0 / 0'; gridEl.classList.add('show');
    } else gridEl.classList.remove('show');
    return;
  }
  const sort = gridEl.dataset.gsort || 'game';
  list.sort(sort === 'points' ? (a, b) => b.Points - a.Points
          : sort === 'rare' ? (a, b) => (a.NumAwarded == null ? 1e9 : a.NumAwarded) - (b.NumAwarded == null ? 1e9 : b.NumAwarded)
          : (a, b) => (a.DisplayOrder || 0) - (b.DisplayOrder || 0));
  const sig = curGame.ID + '|' + sort;
  if (gridSig !== sig) {                                // jogo ou ordem mudou: monta de novo
    if (!gridSig || gridSig.split('|')[0] !== String(curGame.ID)) gridSeen.clear();
    box.textContent = ''; gridCells.clear(); gridPending.clear(); gridQ.length = 0;
    list.forEach(a => {
      const c = mkEl('div', 'g-cell'), im = document.createElement('img');
      im.src = media(`/Badge/${a.BadgeName}.png`); im.alt = ''; c.appendChild(im);
      gridCells.set(String(a.ID), c); box.appendChild(c);
    });
    gridSig = sig;
  }
  list.forEach(a => {                                   // estados: ganhas ficam coloridas; recém-ganhas levam a cabeçada
    const id = String(a.ID), c = gridCells.get(id); if (!c) return;
    if (isEarned(a)) {
      if (!c.classList.contains('on') && !gridPending.has(id)) { if (gridSeen.has(id)) gridUnlock(id); else c.classList.add('on'); }
    } else gridSeen.add(id);
  });
  $('g-title').textContent = curGame.Title;
  gridEl.classList.add('show');
  applyGridFilter();
}

function gridUnlock(id) {
  id = String(id);
  const c = gridCells.get(id);
  if (!c || c.classList.contains('on') || gridPending.has(id)) return;
  gridPending.add(id); gridQ.push(id); gridRun();
}

function gridRun() {
  if (gridBusy || !gridQ.length) return;
  const id = gridQ.shift(), cell = gridCells.get(id);
  const reveal = () => {
    if (!cell) return;
    cell.classList.add('on', 'bump'); setTimeout(() => cell.classList.remove('bump'), 650);
    const a = ach(id);
    if (a) { const p = mkEl('span', 'g-pop', '+' + a.Points); cell.appendChild(p); setTimeout(() => p.remove(), 950); }
    gridPending.delete(id); applyGridFilter();
  };
  const visible = gridEl.classList.contains('show') && getComputedStyle(gridEl).display !== 'none';
  if (!cell || !visible || gridEl.dataset.gan === 'off' || !runnerEl.animate) { reveal(); return gridRun(); }
  gridBusy = true;
  const rs = runnerEl.offsetWidth || 44, cx = cell.offsetLeft + cell.offsetWidth / 2 - rs / 2, gw = gridEl.offsetWidth, D = 2200;
  runnerEl.style.display = 'block'; runnerEl.style.top = (cell.offsetTop + cell.offsetHeight + 2) + 'px';
  const anim = runnerEl.animate([
    { transform: `translate(${-rs - 12}px,0)`, offset: 0 },
    { transform: `translate(${cx}px,0)`,       offset: .5 },
    { transform: `translate(${cx}px,-20px)`,   offset: .58 },    // a cabeçada
    { transform: `translate(${cx}px,0)`,       offset: .68 },
    { transform: `translate(${gw + 12}px,0)`,  offset: 1 }
  ], { duration: D, easing: 'linear' });
  setTimeout(reveal, D * .58);
  const end = () => { runnerEl.style.display = 'none'; gridBusy = false; gridRun(); };
  anim.onfinish = end; anim.oncancel = end;
}

/* ---------- bolinhas: as badges do jogo saem quicando pela tela ao masterizar ---------- */
let bubRaf = 0, bubTimer = 0;
function stopBubbles() { cancelAnimationFrame(bubRaf); clearTimeout(bubTimer); bubEl.textContent = ''; bubEl.style.opacity = ''; }

function burst() {
  stopBubbles();
  if (bubEl.dataset.on === 'off') return;
  const N = Math.round(numVal('bcount')), R = numVal('bsize') / 2, spd = numVal('bspd'), dur = numVal('bdur') * 1000;
  const W = innerWidth, H = innerHeight, g = { off: 0, soft: 500, hard: 1400 }[bubEl.dataset.grav || 'off'];
  const urls = curGame ? Object.values(curGame.Achievements || {}).map(a => media(`/Badge/${a.BadgeName}.png`)) : [];
  if (!urls.length && curGame && curGame.ImageIcon) urls.push(media(curGame.ImageIcon));
  urls.sort(() => Math.random() - .5);                  // poucas conquistas? as imagens se repetem até completar a quantidade
  const m = mastEl.classList.contains('show') ? mastEl.getBoundingClientRect() : null;
  const cx = m && m.width ? m.left + m.width / 2 : W / 2, cy = m && m.height ? m.top + m.height / 2 : H / 2;
  const balls = [];
  for (let i = 0; i < N; i++) {
    const el = mkEl('div', 'bb'); el.style.width = el.style.height = (R * 2) + 'px';
    if (urls.length) { const im = document.createElement('img'); im.src = urls[i % urls.length]; im.alt = ''; el.appendChild(im); }
    else el.style.background = `hsl(${(i * 47) % 360} 70% 55%)`;
    bubEl.appendChild(el);
    const ang = Math.random() * Math.PI * 2, v = spd * (.5 + Math.random() * .6);
    balls.push({ el, x: cx + (Math.random() - .5) * 20, y: cy + (Math.random() - .5) * 20, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v });
  }
  let last = performance.now(); const t0 = last;
  function step(now) {
    const dt = Math.min(0.04, (now - last) / 1000); last = now;
    for (const b of balls) {
      b.vy += g * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); } else if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx); }
      if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy); } else if (b.y > H - R) { b.y = H - R; b.vy = -Math.abs(b.vy) * (g ? .9 : 1); }
    }
    for (let i = 0; i < balls.length; i++) for (let k = i + 1; k < balls.length; k++) {   // colisão elástica entre bolinhas
      const a = balls[i], b = balls[k], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 >= 4 * R * R) continue;
      const d = Math.sqrt(d2) || .01, nx = dx / d, ny = dy / d, push = (2 * R - d) / 2;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) { a.vx += rv * nx; a.vy += rv * ny; b.vx -= rv * nx; b.vy -= rv * ny; }
    }
    for (const b of balls) b.el.style.transform = `translate3d(${b.x - R}px,${b.y - R}px,0)`;
    const left = dur - (now - t0);
    if (left < 1000) bubEl.style.opacity = Math.max(0, left / 1000);      // some suavemente no último segundo
    if (left <= 0) return stopBubbles();
    bubRaf = requestAnimationFrame(step);
  }
  bubRaf = requestAnimationFrame(step);
}

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

/* Gym Wecker – Trainingsplan, Gym-Fortschritt, Trainings- und Kreatin-Wecker als PWA */
'use strict';

const STORE_KEY = 'pushupWecker.v1'; // Schlüssel bleibt, damit vorhandene Daten erhalten bleiben
const APP_NAME = 'Gym Wecker';
const DAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mo..So
const ICAL_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const TYPES = {
  training: { icon: '🏋️', label: 'Training', color: 'indigo',
    svg: SVG('<path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12"/>') },
  creatine: { icon: '💊', label: 'Kreatin', color: 'mint',
    svg: SVG('<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m8.5 8.5 7 7"/>') },
  custom:   { icon: '🔔', label: 'Eigener', color: 'pink',
    svg: SVG('<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>') },
};
const TAB_TITLES = { today: 'Heute', training: 'Training', alarms: 'Wecker', settings: 'Optionen' };
const DEFAULT_EXERCISES = ['Bankdrücken', 'Kniebeuge', 'Kreuzheben', 'Schulterdrücken', 'Klimmzüge',
  'Langhantelrudern', 'Latzug', 'Beinpresse', 'Bizepscurls', 'Trizepsdrücken', 'Dips', 'Ausfallschritte'];
const CATCH_UP_MIN = 10; // verpasste Wecker bis zu 10 Min. nachholen (z. B. Tab war gedrosselt)

const EMBEDDED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- Speicher ---------------- */
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function defaultState() {
  return {
    version: 2,
    settings: { dose: 5, snooze: 5, volume: 0.8, trainPerWeek: 3, trainDays: [1, 3, 5] },
    alarms: [
      { id: uid(), type: 'creatine', name: 'Kreatin nehmen', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6],
        message: '5 g Kreatin mit einem Glas Wasser.', sound: 'chime', enabled: true },
      { id: uid(), type: 'training', name: 'Training', time: '18:00', days: [1, 3, 5],
        message: 'Zeit fürs Training – Tasche packen und los!', sound: 'alarm', enabled: true },
    ],
    log: {},
    workouts: [],
    fired: {},
    snoozes: [],
  };
}

// Ältere Daten (mit Pushups) auf das neue Format bringen
function migrate(s) {
  const d = defaultState();
  const out = { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
  if (!Array.isArray(out.workouts)) out.workouts = [];
  if ((s.version || 1) < 2) {
    out.alarms = (out.alarms || []).filter((a) => a.type !== 'pushups');
    const tr = out.alarms.find((a) => a.type === 'training');
    if (tr && tr.days.length && !(s.settings && s.settings.trainDays)) out.settings.trainDays = [...tr.days];
    delete out.settings.goal;
    out.snoozes = (out.snoozes || []).filter((x) => !x.alarm || x.alarm.type !== 'pushups');
    out.version = 2;
  }
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.warn(e); }
  return defaultState();
}
let state = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.warn(e); }
}

/* ---------------- Zeit-Helfer ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
function shortDate(k) {
  const d = parseKey(k);
  const diff = Math.round((parseKey(dateKey()) - d) / 86400000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  return `${DAY_LABELS[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
}
function today() {
  const k = dateKey();
  if (!state.log[k]) state.log[k] = { creatine: false, training: false };
  return state.log[k];
}
function dayEntry(k) { return state.log[k] || { creatine: false, training: false }; }
const trainedOn = (k) => !!dayEntry(k).training;

function nextOccurrence(alarm, from = new Date()) {
  if (!alarm.days.length) return null;
  const [h, m] = alarm.time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d > from && alarm.days.includes(d.getDay())) return d;
  }
  return null;
}

function dailyStreak(field) {
  let n = 0;
  const d = new Date();
  if (!dayEntry(dateKey(d))[field]) d.setDate(d.getDate() - 1); // heute zählt erst, wenn erledigt
  while (dayEntry(dateKey(d))[field]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ---------- Trainings-Woche & Serie ---------- */
function weekStart(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Montag
  return x;
}
function weekDays(start) {
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
}
function weekCount(start) { return weekDays(start).filter((d) => trainedOn(dateKey(d))).length; }

// Serie in Wochen: jede Woche mit erreichtem Wochenziel zählt; die laufende Woche bricht die Serie nie
function trainingStreak() {
  const goal = state.settings.trainPerWeek;
  const ws = weekStart();
  let n = weekCount(ws) >= goal ? 1 : 0;
  for (let i = 0; i < 520; i++) {
    ws.setDate(ws.getDate() - 7);
    if (weekCount(ws) >= goal) n++; else break;
  }
  return n;
}

function daysText(days) {
  const s = [...days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  if (s.length === 7) return 'Täglich';
  if (s.length === 5 && !s.includes(0) && !s.includes(6)) return 'Mo–Fr';
  if (s.length === 2 && s.includes(0) && s.includes(6)) return 'Wochenende';
  if (!s.length) return 'Nie';
  return s.map((d) => DAY_LABELS[d]).join(', ');
}

function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ---------------- Ton ---------------- */
let audioCtx = null;
function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
// Audio auf iOS beim ersten Tippen freischalten
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => ctx(), { passive: true }));

function tone(freq, start, dur, type = 'sine', vol = 1) {
  const c = ctx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const v = Math.max(0.0001, state.settings.volume * vol);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(v, c.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}
const SOUNDS = {
  alarm() { for (let i = 0; i < 4; i++) { tone(880, i * 0.18, 0.12, 'square', 0.35); } },
  beep() { tone(1000, 0, 0.15, 'sine', 0.6); tone(1000, 0.3, 0.15, 'sine', 0.6); },
  chime() { tone(659, 0, 0.6, 'sine', 0.6); tone(523, 0.35, 0.9, 'sine', 0.6); },
  none() {},
};
let soundLoop = null;
function startSound(name) {
  stopSound();
  const play = SOUNDS[name] || SOUNDS.alarm;
  play();
  if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
  let n = 0;
  soundLoop = setInterval(() => {
    play();
    if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
    if (++n > 90) stopSound(); // max. ca. 2 Minuten
  }, 1400);
}
function stopSound() { clearInterval(soundLoop); soundLoop = null; if (navigator.vibrate) navigator.vibrate(0); }

/* ---------------- Benachrichtigungen ---------------- */
let swReg = null;
if ('serviceWorker' in navigator && !EMBEDDED) {
  navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('message', (e) => {
    const { action, alarmId } = e.data || {};
    const alarm = state.alarms.find((a) => a.id === alarmId);
    if (!alarm) return;
    if (action === 'done') completeAlarm(alarm);
    else if (action === 'snooze') snooze(alarm);
    else ring(alarm, { silentNotify: true });
  });
}

function notifSupported() { return 'Notification' in window; }

async function notify(alarm) {
  if (!notifSupported() || Notification.permission !== 'granted') return;
  const t = TYPES[alarm.type] || TYPES.custom;
  const title = `${t.icon} ${alarm.name}`;
  const opts = {
    body: alarmMessage(alarm),
    tag: 'alarm-' + alarm.id,
    renotify: true,
    requireInteraction: true,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { alarmId: alarm.id },
    actions: [{ action: 'done', title: 'Erledigt' }, { action: 'snooze', title: `Snooze ${state.settings.snooze} Min` }],
  };
  try {
    const reg = swReg || (await navigator.serviceWorker?.getRegistration());
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch (e) {
    try { new Notification(title, { body: opts.body, icon: opts.icon }); } catch (_) { /* ignore */ }
  }
}

function alarmMessage(alarm) {
  if (alarm.message) return alarm.message;
  if (alarm.type === 'creatine') return `${state.settings.dose} g Kreatin nehmen.`;
  if (alarm.type === 'training') return 'Zeit fürs Training!';
  return 'Erinnerung';
}

/* ---------------- Wecker-Engine ---------------- */
let ringingAlarm = null;

function shouldSkip(alarm) {
  const t = today();
  return (alarm.type === 'creatine' && t.creatine) || (alarm.type === 'training' && t.training);
}

function checkAlarms() {
  const now = new Date();
  const dk = dateKey(now);
  let changed = false;

  for (const alarm of state.alarms) {
    if (!alarm.enabled || !alarm.days.includes(now.getDay())) continue;
    const [h, m] = alarm.time.split(':').map(Number);
    const due = new Date(now); due.setHours(h, m, 0, 0);
    const diffMin = (now - due) / 60000;
    if (diffMin < 0 || diffMin > CATCH_UP_MIN) continue;
    if (state.fired[alarm.id] === dk) continue;
    state.fired[alarm.id] = dk;
    changed = true;
    if (!shouldSkip(alarm)) ring(alarm);
  }

  const dueSnoozes = state.snoozes.filter((s) => s.at <= now.getTime());
  if (dueSnoozes.length) {
    state.snoozes = state.snoozes.filter((s) => s.at > now.getTime());
    changed = true;
    for (const s of dueSnoozes) {
      const alarm = state.alarms.find((a) => a.id === s.alarmId) || s.alarm;
      if (alarm) ring(alarm);
    }
  }
  if (changed) save();
}

function ring(alarm, { silentNotify = false } = {}) {
  ringingAlarm = alarm;
  const t = TYPES[alarm.type] || TYPES.custom;
  $('#ringIcon').innerHTML = t.svg;
  $('#ringTime').textContent = hm(new Date());
  $('#ringTitle').textContent = alarm.name;
  $('#ringMsg').textContent = alarmMessage(alarm);
  $('#ringDone').textContent = alarm.type === 'training' ? 'Ich gehe trainieren' : 'Erledigt';
  $('#ringSnooze').textContent = `Snooze ${state.settings.snooze} Min`;
  $('#ringing').classList.remove('hidden');
  startSound(alarm.sound);
  if (!silentNotify) notify(alarm); // auch im Vordergrund, damit es in der Mitteilungszentrale steht
  document.title = `⏰ ${alarm.name}`;
}

function closeRing() {
  stopSound();
  $('#ringing').classList.add('hidden');
  document.title = APP_NAME;
  if (ringingAlarm && swReg) {
    swReg.getNotifications({ tag: 'alarm-' + ringingAlarm.id }).then((ns) => ns.forEach((n) => n.close())).catch(() => {});
  }
  ringingAlarm = null;
}

function completeAlarm(alarm) {
  const t = today();
  if (alarm.type === 'creatine') t.creatine = true;
  if (alarm.type === 'training') t.training = true;
  save();
  closeRing();
  renderAll();
  toast(alarm.type === 'training' ? 'Stark! Trainingstag abgehakt' : 'Erledigt');
}

function snooze(alarm) {
  const at = Date.now() + state.settings.snooze * 60000;
  state.snoozes.push({ alarmId: alarm.id, at, alarm });
  save();
  closeRing();
  toast(`Erinnere dich in ${state.settings.snooze} Minuten`);
}

$('#ringDone').onclick = () => ringingAlarm && completeAlarm(ringingAlarm);
$('#ringSnooze').onclick = () => ringingAlarm && snooze(ringingAlarm);
$('#ringDismiss').onclick = closeRing;

/* ---------------- Wochenleiste ---------------- */
function renderWeekStrip(el) {
  const plan = state.settings.trainDays;
  const todayKey = dateKey();
  el.innerHTML = weekDays(weekStart()).map((d) => {
    const k = dateKey(d);
    const cls = ['wd'];
    if (trainedOn(k)) cls.push('done');
    else if (plan.includes(d.getDay())) cls.push(k < todayKey ? 'missed' : 'planned');
    if (k === todayKey) cls.push('today');
    return `<div class="${cls.join(' ')}"><span class="wd-label">${DAY_LABELS[d.getDay()]}</span>` +
      `<span class="wd-dot">${SVG('<path d="m6 12.5 4 4L18 8.5"/>')}</span></div>`;
  }).join('');
}
function weekText() {
  const n = weekCount(weekStart());
  const goal = state.settings.trainPerWeek;
  return n >= goal ? `Wochenziel erreicht · ${n}×` : `${n} von ${goal}`;
}

/* ---------------- Ansicht: Heute ---------------- */
function renderToday() {
  const t = today();
  const dose = state.settings.dose;
  $('#creatineBtn').classList.toggle('done', t.creatine);
  $('#creatineState').textContent = t.creatine ? `${dose} g genommen` : `${dose} g noch offen`;
  const cs = dailyStreak('creatine');
  $('#creatineStreak').textContent = cs ? `${cs} ${cs === 1 ? 'Tag' : 'Tage'} in Folge` : '';

  const planned = state.settings.trainDays.includes(new Date().getDay());
  $('#trainingBtn').classList.toggle('done', t.training);
  $('#trainingState').textContent = t.training ? 'Heute erledigt' : planned ? 'Heute ist Trainingstag' : 'Ruhetag';
  const ws = trainingStreak();
  $('#trainingStreak').textContent = ws ? `${ws} ${ws === 1 ? 'Woche' : 'Wochen'} in Folge` : weekText() + ' diese Woche';

  $('#weekCountToday').textContent = weekText();
  renderWeekStrip($('#weekStripToday'));

  const next = state.alarms
    .filter((a) => a.enabled)
    .map((a) => ({ a, at: nextOccurrence(a) }))
    .filter((x) => x.at)
    .sort((x, y) => x.at - y.at)[0];
  if (next) {
    const isToday = dateKey(next.at) === dateKey();
    const day = isToday ? 'Heute' : DAY_LABELS[next.at.getDay()];
    const mins = Math.round((next.at - new Date()) / 60000);
    const rel = mins < 60 ? `in ${mins} Min` : `in ${Math.floor(mins / 60)} h ${mins % 60} Min`;
    $('#nextTime').textContent = next.a.time;
    $('#nextAlarm').textContent = `${day} · ${next.a.name} · ${rel}`;
  } else {
    $('#nextTime').textContent = '–';
    $('#nextAlarm').textContent = 'Kein Wecker aktiv';
  }
}

$('#creatineBtn').onclick = () => { const t = today(); t.creatine = !t.creatine; save(); renderToday(); };
$('#trainingBtn').onclick = () => openWorkout(dateKey());

/* ---------------- Ansicht: Training ---------------- */
function buildDayChips(el, name) {
  for (const d of DAY_ORDER) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" name="${name}" value="${d}"><span>${DAY_LABELS[d]}</span>`;
    el.appendChild(l);
  }
}
buildDayChips($('#planDays'), 'plan');
buildDayChips($('#dayPicker'), 'day');

function renderTraining() {
  const s = state.settings;
  const ws = trainingStreak();
  $('#streakNum').textContent = ws;
  $('#streakUnit').textContent = ws === 1 ? 'Woche in Folge' : 'Wochen in Folge';
  const n = weekCount(weekStart());
  $('#streakSub').textContent = n >= s.trainPerWeek
    ? `Wochenziel erreicht: ${n} von ${s.trainPerWeek} Trainings.`
    : `Diese Woche ${n} von ${s.trainPerWeek} Trainings. Noch ${s.trainPerWeek - n} bis zum Wochenziel.`;
  renderWeekStrip($('#weekStrip'));

  $('#perWeek').textContent = s.trainPerWeek;
  $$('#planDays input').forEach((i) => { i.checked = s.trainDays.includes(Number(i.value)); });

  renderProgress();
  renderWorkoutList();
}

function setPerWeek(v) {
  state.settings.trainPerWeek = Math.min(7, Math.max(1, v));
  save(); renderAll();
}
$('#perWeekMinus').onclick = () => setPerWeek(state.settings.trainPerWeek - 1);
$('#perWeekPlus').onclick = () => setPerWeek(state.settings.trainPerWeek + 1);

$('#planDays').addEventListener('change', () => {
  const days = $$('#planDays input').filter((i) => i.checked).map((i) => Number(i.value));
  state.settings.trainDays = days;
  // Trainings-Wecker folgen dem Plan
  const tr = state.alarms.filter((a) => a.type === 'training');
  if (days.length) tr.forEach((a) => { a.days = [...days]; });
  save(); renderAll();
  if (tr.length && days.length) toast(`Trainings-Wecker: ${daysText(days)}`);
});

/* ---------- Fortschritt ---------- */
const exKey = (name) => name.trim().toLowerCase();
function exerciseSeries() {
  const map = new Map();
  const sorted = [...state.workouts].sort((a, b) => a.date.localeCompare(b.date));
  for (const w of sorted) {
    const perWorkout = new Map();
    for (const e of w.exercises || []) {
      if (!e.name || !e.name.trim()) continue;
      const k = exKey(e.name);
      const cur = perWorkout.get(k) || { name: e.name.trim(), weight: 0, reps: 0 };
      cur.weight = Math.max(cur.weight, Number(e.weight) || 0);
      cur.reps = Math.max(cur.reps, Number(e.reps) || 0);
      cur.name = e.name.trim();
      perWorkout.set(k, cur);
    }
    for (const [k, v] of perWorkout) {
      if (!map.has(k)) map.set(k, { name: v.name, points: [] });
      const entry = map.get(k);
      entry.name = v.name;
      entry.points.push({ date: w.date, weight: v.weight, reps: v.reps });
    }
  }
  return [...map.values()].map((x) => {
    const useWeight = x.points.some((p) => p.weight > 0);
    const pts = x.points.map((p) => ({ date: p.date, v: useWeight ? p.weight : p.reps }));
    return { name: x.name, unit: useWeight ? 'kg' : 'Wdh.', pts, last: pts[pts.length - 1].date };
  }).sort((a, b) => b.last.localeCompare(a.last));
}

function fmt(v) { return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','); }

function sparkline(values) {
  const W = 120, H = 40, P = 4;
  if (values.length < 2) {
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><circle cx="${W - P}" cy="${H / 2}" r="3.5" class="spark-end"/></svg>`;
  }
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const xs = values.map((_, i) => P + (i * (W - 2 * P)) / (values.length - 1));
  const ys = values.map((v) => H - P - ((v - min) / span) * (H - 2 * P));
  const line = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const area = `${P},${H} ${line} ${W - P},${H}`;
  const lx = xs[xs.length - 1], ly = ys[ys.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <polygon points="${area}" class="spark-area"/>
    <polyline points="${line}" class="spark-line"/>
    <circle cx="${lx}" cy="${ly}" r="3.5" class="spark-end"/></svg>`;
}

function progressCard(title, unit, pts, sub, neutral = false) {
  const vals = pts.slice(-12).map((p) => p.v);
  const last = pts[pts.length - 1].v;
  const first = pts[0].v;
  const best = Math.max(...pts.map((p) => p.v));
  const diff = last - first;
  const trend = pts.length < 2 ? '' :
    `<span class="trend ${neutral ? '' : diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '+' : ''}${fmt(diff)} ${unit}</span>`;
  const pr = !neutral && last === best && pts.length > 1 && diff > 0 ? '<span class="pr">Bestleistung</span>' : '';
  return `<div class="glass prog">
    <div class="prog-head"><span class="prog-name">${esc(title)}</span>${pr}</div>
    <div class="prog-body">
      <div class="prog-val"><b>${fmt(last)}</b> <span>${unit}</span></div>
      ${sparkline(vals)}
    </div>
    <div class="prog-foot"><span>${sub}</span>${trend}</div>
  </div>`;
}

function renderProgress() {
  const el = $('#progressList');
  const series = exerciseSeries();
  const bw = [...state.workouts].filter((w) => Number(w.bodyweight) > 0)
    .sort((a, b) => a.date.localeCompare(b.date)).map((w) => ({ date: w.date, v: Number(w.bodyweight) }));
  let html = '';
  if (bw.length) html += progressCard('Körpergewicht', 'kg', bw, `${bw.length} ${bw.length === 1 ? 'Messung' : 'Messungen'}`, true);
  for (const s of series) {
    const best = Math.max(...s.pts.map((p) => p.v));
    html += progressCard(s.name, s.unit, s.pts, `Bestwert ${fmt(best)} ${s.unit} · ${s.pts.length}× trainiert`);
  }
  el.innerHTML = html || `<div class="glass card empty-card">
      <p><b>Noch kein Fortschritt</b></p>
      <p class="muted small">Trage dein nächstes Training mit Übungen und Gewicht ein. Hier siehst du dann pro Übung deine Kurve und deine Bestleistung.</p>
    </div>`;
}

function workoutSummary(w) {
  const ex = (w.exercises || []).filter((e) => e.name && e.name.trim());
  if (!ex.length) return w.note ? w.note : 'Ohne Übungen';
  return ex.map((e) => {
    const sr = e.sets && e.reps ? ` ${e.sets}×${e.reps}` : e.reps ? ` ${e.reps} Wdh.` : '';
    const kg = Number(e.weight) > 0 ? ` · ${fmt(Number(e.weight))} kg` : '';
    return `${e.name.trim()}${sr}${kg}`;
  }).join(', ');
}

function renderWorkoutList() {
  const el = $('#workoutList');
  // Tage, die nur abgehakt wurden (z. B. über den Wecker), auch zeigen
  const items = state.workouts.map((w) => ({ date: w.date, w }));
  for (const [k, e] of Object.entries(state.log)) {
    if (e.training && !state.workouts.some((w) => w.date === k)) items.push({ date: k, w: null });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  const shown = items.slice(0, 12);
  if (!shown.length) {
    el.innerHTML = '<div class="cell"><span class="muted">Noch keine Trainings eingetragen.</span></div>';
    return;
  }
  el.innerHTML = '';
  for (const it of shown) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'cell cell-btn';
    row.innerHTML = `<span class="squircle indigo small">${TYPES.training.svg}</span>
      <span class="cell-text"><b></b><small></small></span>
      <span class="chev">${SVG('<path d="m9 6 6 6-6 6"/>')}</span>`;
    row.querySelector('b').textContent = shortDate(it.date);
    row.querySelector('small').textContent = it.w ? workoutSummary(it.w) : 'Abgehakt';
    row.onclick = () => (it.w ? openWorkout(it.date, it.w) : openWorkout(it.date));
    el.appendChild(row);
  }
}

/* ---------- Training eintragen ---------- */
const wForm = $('#workoutForm');
let editingWorkout = null;

function knownExercises() {
  const names = new Map();
  for (const w of state.workouts) for (const e of w.exercises || []) if (e.name && e.name.trim()) names.set(exKey(e.name), e.name.trim());
  for (const n of DEFAULT_EXERCISES) if (!names.has(exKey(n))) names.set(exKey(n), n);
  return [...names.values()];
}

function lastTime(name, beforeDate, excludeId) {
  const k = exKey(name);
  const ws = [...state.workouts].filter((w) => w.id !== excludeId && w.date <= beforeDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const w of ws) {
    const e = (w.exercises || []).find((x) => x.name && exKey(x.name) === k);
    if (e) return { w, e };
  }
  return null;
}

function updateHint(row) {
  const name = row.querySelector('[data-f=name]').value;
  const hint = row.querySelector('.ex-last');
  const found = name.trim() ? lastTime(name, wForm.date.value || dateKey(), editingWorkout && editingWorkout.id) : null;
  if (!found) { hint.textContent = ''; return; }
  const { w, e } = found;
  const sr = e.sets && e.reps ? `${e.sets} × ${e.reps}` : e.reps ? `${e.reps} Wdh.` : '';
  const kg = Number(e.weight) > 0 ? `${fmt(Number(e.weight))} kg` : '';
  hint.textContent = `Letztes Mal (${shortDate(w.date)}): ${[sr, kg].filter(Boolean).join(' · ') || 'ohne Angaben'}`;
}

function addExerciseRow(ex = {}) {
  const row = document.createElement('div');
  row.className = 'glass ex-row';
  row.innerHTML = `
    <div class="ex-top">
      <input data-f="name" list="exNames" placeholder="Übung, z. B. Bankdrücken" maxlength="40" aria-label="Übung">
      <button type="button" class="ex-del" aria-label="Übung entfernen">${SVG('<path d="M6 6l12 12M18 6 6 18"/>')}</button>
    </div>
    <div class="ex-nums">
      <label><input data-f="sets" type="number" min="0" max="20" inputmode="numeric" placeholder="3"><span>Sätze</span></label>
      <label><input data-f="reps" type="number" min="0" max="200" inputmode="numeric" placeholder="10"><span>Wdh.</span></label>
      <label><input data-f="weight" type="number" min="0" max="1000" step="0.5" inputmode="decimal" placeholder="0"><span>kg</span></label>
    </div>
    <div class="ex-last"></div>`;
  row.querySelector('[data-f=name]').value = ex.name || '';
  row.querySelector('[data-f=sets]').value = ex.sets || '';
  row.querySelector('[data-f=reps]').value = ex.reps || '';
  row.querySelector('[data-f=weight]').value = ex.weight || '';
  row.querySelector('.ex-del').onclick = () => row.remove();
  row.querySelector('[data-f=name]').addEventListener('input', () => updateHint(row));
  $('#exRows').appendChild(row);
  updateHint(row);
  return row;
}

function openWorkout(date, workout) {
  const w = workout || state.workouts.filter((x) => x.date === date).slice(-1)[0] || null;
  editingWorkout = w;
  $('#exNames').innerHTML = knownExercises().map((n) => `<option value="${esc(n)}"></option>`).join('');
  $('#exRows').innerHTML = '';
  wForm.date.value = w ? w.date : date;
  wForm.bodyweight.value = w && w.bodyweight ? w.bodyweight : '';
  wForm.note.value = w && w.note ? w.note : '';
  (w && w.exercises && w.exercises.length ? w.exercises : [{}]).forEach((e) => addExerciseRow(e));
  $('#workoutTitle').textContent = w ? 'Training bearbeiten' : 'Training eintragen';
  const del = $('#deleteWorkout');
  if (del.dataset.armed) { delete del.dataset.armed; del.textContent = del.dataset.orig; }
  del.classList.toggle('hidden', !(w || trainedOn(date)));
  $('#workoutDialog').showModal();
}
$('#addWorkout').onclick = () => openWorkout(dateKey(), null);
$('#addEx').onclick = () => { const r = addExerciseRow(); r.querySelector('[data-f=name]').focus(); };
wForm.date.addEventListener('change', () => $$('#exRows .ex-row').forEach(updateHint));

function syncTrainingFlag(date) {
  const has = state.workouts.some((w) => w.date === date);
  if (!state.log[date]) state.log[date] = { creatine: false, training: false };
  state.log[date].training = has;
}

wForm.addEventListener('submit', (e) => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  const date = wForm.date.value || dateKey();
  const exercises = $$('#exRows .ex-row').map((r) => ({
    name: r.querySelector('[data-f=name]').value.trim(),
    sets: Number(r.querySelector('[data-f=sets]').value) || 0,
    reps: Number(r.querySelector('[data-f=reps]').value) || 0,
    weight: Number(r.querySelector('[data-f=weight]').value) || 0,
  })).filter((x) => x.name);
  const data = { date, exercises, bodyweight: Number(wForm.bodyweight.value) || 0, note: wForm.note.value.trim() };
  if (editingWorkout) {
    const oldDate = editingWorkout.date;
    Object.assign(editingWorkout, data);
    syncTrainingFlag(oldDate);
  } else {
    state.workouts.push({ id: uid(), ...data });
  }
  syncTrainingFlag(date);
  save(); renderAll();
  const ws = trainingStreak();
  toast(ws > 0 ? `Gespeichert · ${ws} ${ws === 1 ? 'Woche' : 'Wochen'} in Folge` : 'Training gespeichert');
});

$('#deleteWorkout').onclick = (e) => {
  if (!armed(e.currentTarget, 'Wirklich entfernen?')) return;
  const date = editingWorkout ? editingWorkout.date : wForm.date.value;
  if (editingWorkout) state.workouts = state.workouts.filter((w) => w !== editingWorkout);
  syncTrainingFlag(date);
  save(); $('#workoutDialog').close('deleted'); renderAll(); toast('Training entfernt');
};

/* ---------------- Ansicht: Wecker ---------------- */
function renderAlarms() {
  const list = $('#alarmList');
  list.innerHTML = '';
  const sorted = [...state.alarms].sort((a, b) => a.time.localeCompare(b.time));
  for (const a of sorted) {
    const li = document.createElement('li');
    li.className = 'alarm glass' + (a.enabled ? '' : ' off');
    const t = TYPES[a.type] || TYPES.custom;
    li.innerHTML = `
      <span class="squircle ${t.color}">${t.svg}</span>
      <div class="info">
        <div class="time"></div>
        <div class="meta"></div>
      </div>
      <button class="icsBtn" title="Diesen Wecker in den Kalender" aria-label="In Kalender">${SVG('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>')}</button>
      <label class="switch"><input type="checkbox"><span></span></label>`;
    li.querySelector('.time').textContent = a.time;
    li.querySelector('.meta').textContent = `${a.name} · ${daysText(a.days)}`;
    li.querySelector('.info').onclick = () => openEditor(a);
    li.querySelector('.icsBtn').onclick = () => exportIcs([a]);
    const sw = li.querySelector('input');
    sw.checked = a.enabled;
    sw.onchange = () => { a.enabled = sw.checked; save(); renderAlarms(); renderToday(); };
    list.appendChild(li);
  }
  if (!sorted.length) list.innerHTML = '<li class="empty">Noch keine Wecker. Tippe auf „Neu“.</li>';
}

let editing = null;
const form = $('#editForm');
function openEditor(alarm) {
  editing = alarm || null;
  const a = alarm || { type: 'training', name: 'Training', time: hm(new Date(Date.now() + 5 * 60000)),
    days: state.settings.trainDays.length ? [...state.settings.trainDays] : [1, 3, 5], message: '', sound: 'alarm', enabled: true };
  $('#editTitle').textContent = alarm ? 'Wecker bearbeiten' : 'Neuer Wecker';
  form.type.value = TYPES[a.type] ? a.type : 'custom';
  form.name.value = a.name;
  form.time.value = a.time;
  form.message.value = a.message || '';
  form.sound.value = a.sound;
  $$('#dayPicker input').forEach((i) => { i.checked = a.days.includes(Number(i.value)); });
  const del = $('#deleteAlarm');
  del.classList.toggle('hidden', !alarm);
  if (del.dataset.armed) { delete del.dataset.armed; del.textContent = del.dataset.orig; }
  $('#editDialog').showModal();
}
form.type.addEventListener('change', () => {
  const names = { training: 'Training', creatine: 'Kreatin nehmen', custom: 'Erinnerung' };
  if (!editing && Object.values(names).includes(form.name.value)) form.name.value = names[form.type.value];
  form.sound.value = form.type.value === 'creatine' ? 'chime' : 'alarm';
  const days = form.type.value === 'creatine' ? [0, 1, 2, 3, 4, 5, 6]
    : form.type.value === 'training' && state.settings.trainDays.length ? state.settings.trainDays : null;
  if (!editing && days) $$('#dayPicker input').forEach((i) => { i.checked = days.includes(Number(i.value)); });
});
$('#previewSound').onclick = () => { ctx(); (SOUNDS[form.sound.value] || SOUNDS.alarm)(); };
$('#addAlarm').onclick = () => openEditor(null);
function armed(btn, label) {
  // Bestätigung ohne confirm(): erst beim zweiten Tippen ausführen
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; return true; }
  btn.dataset.orig = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; } }, 3000);
  return false;
}
$('#deleteAlarm').onclick = (e) => {
  if (editing && armed(e.currentTarget, 'Wirklich löschen?')) {
    state.alarms = state.alarms.filter((a) => a !== editing);
    save(); $('#editDialog').close('deleted'); renderAll(); toast('Wecker gelöscht');
  }
};
form.addEventListener('submit', (e) => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  const days = $$('#dayPicker input').filter((i) => i.checked).map((i) => Number(i.value));
  if (!days.length) { e.preventDefault(); toast('Bitte mindestens einen Tag wählen'); return; }
  const data = {
    type: form.type.value,
    name: form.name.value.trim() || TYPES[form.type.value].label,
    time: form.time.value,
    days,
    message: form.message.value.trim(),
    sound: form.sound.value,
  };
  if (editing) {
    Object.assign(editing, data);
    delete state.fired[editing.id]; // geänderte Uhrzeit heute erneut erlauben
  } else {
    state.alarms.push({ id: uid(), enabled: true, ...data });
  }
  save(); renderAll();
  toast('Wecker gespeichert');
});

/* ---------------- Kalender-Export (.ics) ---------------- */
function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
function fold(line) {
  // RFC 5545: Zeilen max. 75 Oktette
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}
function icsDate(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}
function buildIcs(alarms) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${APP_NAME}//DE`, 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${APP_NAME}`];
  for (const a of alarms) {
    const start = nextOccurrence(a, now) || now;
    const end = new Date(start.getTime() + 10 * 60000);
    const t = TYPES[a.type] || TYPES.custom;
    const title = `${t.icon} ${a.name}`;
    const msg = alarmMessage(a);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${a.id}@pushup-wecker`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${a.days.map((d) => ICAL_DAYS[d]).join(',')}`,
      `SUMMARY:${icsEscape(title)}`,
      `DESCRIPTION:${icsEscape(msg)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(title + ' – ' + msg)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
function icsFile(alarms) {
  const name = alarms.length === 1 ? `wecker-${alarms[0].name.replace(/[^\w-]+/g, '_')}.ics` : 'gym-wecker.ics';
  return new File([buildIcs(alarms)], name, { type: 'text/calendar' });
}
function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function exportIcs(alarms) {
  const list = alarms || state.alarms.filter((a) => a.enabled);
  if (!list.length) { toast('Keine aktiven Wecker'); return; }
  const file = icsFile(list);
  // Auf iPhone/iPad ist das Teilen-Menü der zuverlässigste Weg in den Kalender
  if (isIOS() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: APP_NAME }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(file);
  toast('Kalender-Datei gespeichert – öffnen und „Alle hinzufügen“', 4000);
}
$('#exportIcs').onclick = () => exportIcs();
if (EMBEDDED) {
  // In der eingebetteten Vorschau sind Downloads gesperrt
  $('#exportIcs').classList.add('hidden');
  $('#embeddedNote').classList.remove('hidden');
} else if (navigator.canShare) {
  $('#shareIcs').classList.remove('hidden');
  $('#shareIcs').onclick = async () => {
    const file = icsFile(state.alarms.filter((a) => a.enabled));
    try { await navigator.share({ files: [file], title: APP_NAME }); } catch (e) { /* abgebrochen */ }
  };
}

/* ---------------- Ansicht: Einstellungen ---------------- */
function renderSettings() {
  const s = state.settings;
  $('#setDose').value = s.dose;
  $('#setSnooze').value = s.snooze;
  $('#setVolume').value = s.volume;
  $('#setAwake').checked = !!s.keepAwake;
  let txt;
  if (!notifSupported()) {
    txt = isIOS() && !isStandalone()
      ? 'Auf dem iPhone/iPad gehen Mitteilungen nur, wenn die App über „Teilen → Zum Home-Bildschirm“ installiert wurde.'
      : 'Dieser Browser unterstützt keine Mitteilungen. Wecker klingeln trotzdem, solange die App offen ist.';
    $('#askNotif').classList.add('hidden');
  } else if (Notification.permission === 'granted') {
    txt = 'Mitteilungen sind erlaubt. Die App weckt dich, solange sie geöffnet ist bzw. im Hintergrund läuft. Für geschlossene App: Kalender-Export nutzen.';
    $('#askNotif').classList.add('hidden');
  } else if (Notification.permission === 'denied') {
    txt = 'Mitteilungen wurden blockiert. Bitte in den System-/Browser-Einstellungen erlauben.';
    $('#askNotif').classList.add('hidden');
  } else {
    txt = 'Erlaube Mitteilungen, damit der Wecker auch auftaucht, wenn du in einem anderen Fenster bist.';
    $('#askNotif').classList.remove('hidden');
  }
  $('#notifStatus').textContent = txt;
}
function bindSetting(id, key, min, max) {
  $(id).addEventListener('change', (e) => {
    let v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    v = Math.min(max, Math.max(min, v));
    state.settings[key] = v; save(); renderAll();
  });
}
bindSetting('#setDose', 'dose', 1, 30);
bindSetting('#setSnooze', 'snooze', 1, 60);
bindSetting('#setVolume', 'volume', 0, 1);
$('#setVolume').addEventListener('input', (e) => { state.settings.volume = Number(e.target.value); });

$('#askNotif').onclick = async () => {
  ctx();
  try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
  renderSettings();
};
$('#testAlarm').onclick = () => {
  ctx();
  toast('Test-Wecker klingelt in 5 Sekunden…');
  const test = { id: 'test', type: 'custom', name: 'Test-Wecker', message: 'So klingt dein Wecker.', sound: 'alarm' };
  setTimeout(() => ring(test), 5000);
};

$('#backupBtn').onclick = async () => {
  const json = JSON.stringify(state, null, 2);
  const filename = `gym-wecker-backup-${dateKey()}.json`;
  if (EMBEDDED) {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (dl) {
      try { await dl.save({ filename, data: json }); toast('Backup gespeichert'); return; }
      catch (e) { if (e && e.code === 'declined') return; }
    }
    const ta = $('#backupText');
    ta.value = JSON.stringify(state);
    ta.classList.remove('hidden'); ta.select();
    navigator.clipboard?.writeText(ta.value).then(() => toast('Backup kopiert'), () => toast('Text markiert – kopieren und als .json speichern'));
    return;
  }
  download(new File([json], filename, { type: 'application/json' }));
};
$('#restoreInput').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.alarms) || typeof data.log !== 'object') throw new Error('Ungültig');
    state = migrate(data);
    save(); renderAll(); toast('Backup geladen');
  } catch (err) { toast('Backup-Datei ungültig'); }
  e.target.value = '';
};

/* ---------------- Bildschirm wach halten ---------------- */
let wakeLock = null;
async function applyWakeLock() {
  const want = !!state.settings.keepAwake && !document.hidden;
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
$('#setAwake').addEventListener('change', (e) => {
  state.settings.keepAwake = e.target.checked; save(); ctx(); applyWakeLock();
  if (e.target.checked && !navigator.wakeLock) toast('Dieses Gerät unterstützt das leider nicht');
});
document.addEventListener('visibilitychange', applyWakeLock);

/* ---------------- Installation ---------------- */
function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); installEvent = e;
  const h = $('#installHint');
  h.innerHTML = '<b>Als App installieren</b><p class="muted small">Installiere den Gym Wecker auf deinem PC. Dann läuft er in einem eigenen Fenster und startet mit einem Klick.</p><button class="btn tinted" id="installBtn">Installieren</button>';
  h.classList.remove('hidden');
  $('#installBtn').onclick = async () => { installEvent.prompt(); await installEvent.userChoice; h.classList.add('hidden'); };
});
if (isIOS() && !isStandalone() && !EMBEDDED) {
  const h = $('#installHint');
  h.innerHTML = '<b>Auf den Home-Bildschirm</b><p class="muted small">Tippe unten in Safari auf <b>Teilen</b> (□↑) → <b>Zum Home-Bildschirm</b>. Erst dann kann die App dir Mitteilungen schicken.</p>';
  h.classList.remove('hidden');
}

/* ---------------- Tabs & Start ---------------- */
function showTab(name) {
  if (!TAB_TITLES[name]) name = 'today';
  $$('.tabbar button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  $('#pageTitle').textContent = TAB_TITLES[name];
  renderAll();
  try { localStorage.setItem(STORE_KEY + '.tab', name); } catch (e) { /* ignore */ }
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

function renderAll() { renderToday(); renderTraining(); renderAlarms(); renderSettings(); }

function tickClock() {
  const d = new Date();
  $('#clock').textContent = hm(d);
  $('#dateLabel').textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  if (ringingAlarm) $('#ringTime').textContent = hm(d);
}

// Tagesmarkierungen älter als 2 Jahre aufräumen (Trainings bleiben für den Fortschritt erhalten)
(function prune() {
  const cutoff = dateKey(new Date(Date.now() - 2 * 366 * 86400000));
  for (const k of Object.keys(state.log)) if (k < cutoff) delete state.log[k];
})();

// Klick auf Mitteilung öffnet App mit ?alarm=ID
const params = new URLSearchParams(location.search);
if (params.get('alarm')) {
  const a = state.alarms.find((x) => x.id === params.get('alarm'));
  if (a && params.get('action') === 'done') completeAlarm(a);
  history.replaceState(null, '', location.pathname);
}

save();
let startTab = 'today';
try { startTab = localStorage.getItem(STORE_KEY + '.tab') || 'today'; } catch (e) { /* ignore */ }
showTab(startTab);
tickClock();
applyWakeLock();
checkAlarms();
setInterval(() => { tickClock(); checkAlarms(); }, 5000);
setInterval(renderToday, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkAlarms(); renderAll(); } });

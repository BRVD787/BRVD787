/* PushUp Wecker – eigene Pushup-, Trainings- und Kreatin-Wecker als PWA */
'use strict';

const STORE_KEY = 'pushupWecker.v1';
const DAY_LABELS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mo..So
const ICAL_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const TYPES = {
  pushups:  { icon: '💪', label: 'Pushups', color: 'orange',
    svg: SVG('<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5.5.8 1.2 1.5 1.8 2.5 2C12 7 12 5 12 3z"/>') },
  training: { icon: '🏋️', label: 'Training', color: 'indigo',
    svg: SVG('<path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12"/>') },
  creatine: { icon: '💊', label: 'Kreatin', color: 'mint',
    svg: SVG('<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m8.5 8.5 7 7"/>') },
  custom:   { icon: '🔔', label: 'Eigener', color: 'pink',
    svg: SVG('<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>') },
};
const TAB_TITLES = { today: 'Heute', alarms: 'Wecker', history: 'Verlauf', settings: 'Optionen' };
const RING_LEN = 2 * Math.PI * 50;
const CATCH_UP_MIN = 10; // verpasste Wecker bis zu 10 Min. nachholen (z. B. Tab war gedrosselt)

const EMBEDDED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ---------------- Speicher ---------------- */
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function defaultState() {
  return {
    settings: { goal: 100, dose: 5, snooze: 5, volume: 0.8 },
    alarms: [
      { id: uid(), type: 'creatine', name: 'Kreatin nehmen', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6],
        reps: 0, message: '5 g Kreatin mit einem Glas Wasser.', sound: 'chime', enabled: true },
      { id: uid(), type: 'pushups', name: 'Pushup-Pause', time: '12:00', days: [1, 2, 3, 4, 5],
        reps: 25, message: 'Runter auf den Boden – 25 saubere Pushups!', sound: 'alarm', enabled: true },
      { id: uid(), type: 'pushups', name: 'Pushup-Pause', time: '16:00', days: [1, 2, 3, 4, 5],
        reps: 25, message: 'Zweite Runde: 25 Pushups!', sound: 'alarm', enabled: true },
      { id: uid(), type: 'training', name: 'Training', time: '18:00', days: [1, 3, 5],
        reps: 0, message: 'Zeit fürs Training – Tasche packen und los!', sound: 'alarm', enabled: true },
    ],
    log: {},
    fired: {},
    snoozes: [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const d = defaultState();
      return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
    }
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
function today() {
  const k = dateKey();
  if (!state.log[k]) state.log[k] = { pushups: 0, creatine: false, training: false };
  return state.log[k];
}
function dayEntry(k) { return state.log[k] || { pushups: 0, creatine: false, training: false }; }

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

function streak(field) {
  let n = 0;
  const d = new Date();
  if (!dayEntry(dateKey(d))[field]) d.setDate(d.getDate() - 1); // heute zählt erst, wenn erledigt
  while (dayEntry(dateKey(d))[field]) { n++; d.setDate(d.getDate() - 1); }
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
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => ctx(), { once: false, passive: true }));

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
    actions: [{ action: 'done', title: 'Erledigt ✔' }, { action: 'snooze', title: `Snooze ${state.settings.snooze} Min` }],
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
  if (alarm.type === 'pushups') return `${alarm.reps || 20} Pushups – jetzt!`;
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
  $('#ringDone').textContent = alarm.type === 'pushups' ? `${alarm.reps || 0} geschafft` : 'Erledigt';
  $('#ringSnooze').textContent = `Snooze ${state.settings.snooze} Min`;
  $('#ringing').classList.remove('hidden');
  startSound(alarm.sound);
  if (!silentNotify) notify(alarm); // auch im Vordergrund, damit es in der Mitteilungszentrale steht
  document.title = `⏰ ${alarm.name}`;
}

function closeRing() {
  stopSound();
  $('#ringing').classList.add('hidden');
  document.title = 'PushUp Wecker';
  if (ringingAlarm && swReg) {
    swReg.getNotifications({ tag: 'alarm-' + ringingAlarm.id }).then((ns) => ns.forEach((n) => n.close())).catch(() => {});
  }
  ringingAlarm = null;
}

function completeAlarm(alarm) {
  const t = today();
  if (alarm.type === 'pushups') { t.pushups += Number(alarm.reps) || 0; }
  if (alarm.type === 'creatine') t.creatine = true;
  if (alarm.type === 'training') t.training = true;
  save();
  closeRing();
  renderToday();
  toast(alarm.type === 'pushups' ? `Stark! +${alarm.reps} Pushups` : 'Erledigt');
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

/* ---------------- Ansicht: Heute ---------------- */
function renderToday() {
  const t = today();
  const goal = state.settings.goal;
  $('#pushupCount').textContent = t.pushups;
  $('#pushupGoalLabel').textContent = t.pushups >= goal ? 'Ziel erreicht' : `von ${goal}`;
  $('#ringProgress').style.strokeDashoffset = RING_LEN * (1 - Math.min(1, t.pushups / goal));
  $('#ringProgress').style.opacity = t.pushups > 0 ? 1 : 0;

  const dose = state.settings.dose;
  $('#creatineBtn').classList.toggle('done', t.creatine);
  $('#creatineState').textContent = t.creatine ? `${dose} g genommen` : `${dose} g noch offen`;
  const cs = streak('creatine');
  $('#creatineStreak').textContent = cs ? `${cs} ${cs === 1 ? 'Tag' : 'Tage'} in Folge` : '';

  $('#trainingBtn').classList.toggle('done', t.training);
  $('#trainingState').textContent = t.training ? 'Erledigt' : 'Noch offen';
  const ts = streak('training');
  $('#trainingStreak').textContent = ts ? `${ts} ${ts === 1 ? 'Tag' : 'Tage'} in Folge` : '';

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

$$('[data-add]').forEach((b) => b.addEventListener('click', () => {
  const t = today();
  t.pushups = Math.max(0, t.pushups + Number(b.dataset.add));
  save(); renderToday();
}));
$('#creatineBtn').onclick = () => { const t = today(); t.creatine = !t.creatine; save(); renderToday(); };
$('#trainingBtn').onclick = () => { const t = today(); t.training = !t.training; save(); renderToday(); };

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
    li.querySelector('.meta').textContent =
      `${a.name}${a.type === 'pushups' ? ` · ${a.reps}×` : ''} · ${daysText(a.days)}`;
    li.querySelector('.info').onclick = () => openEditor(a);
    li.querySelector('.icsBtn').onclick = () => exportIcs([a]);
    const sw = li.querySelector('input');
    sw.checked = a.enabled;
    sw.onchange = () => { a.enabled = sw.checked; save(); renderAlarms(); renderToday(); };
    list.appendChild(li);
  }
  if (!sorted.length) list.innerHTML = '<li class="empty">Noch keine Wecker. Tippe auf „Neu“.</li>';
}

// Tage-Auswahl aufbauen
(function buildDayPicker() {
  const dp = $('#dayPicker');
  for (const d of DAY_ORDER) {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" name="day" value="${d}"><span>${DAY_LABELS[d]}</span>`;
    dp.appendChild(l);
  }
})();

let editing = null;
const form = $('#editForm');
function openEditor(alarm) {
  editing = alarm || null;
  const a = alarm || { type: 'pushups', name: 'Pushups', time: hm(new Date(Date.now() + 5 * 60000)),
    days: [0, 1, 2, 3, 4, 5, 6], reps: 20, message: '', sound: 'alarm', enabled: true };
  $('#editTitle').textContent = alarm ? 'Wecker bearbeiten' : 'Neuer Wecker';
  form.type.value = a.type;
  form.name.value = a.name;
  form.time.value = a.time;
  form.reps.value = a.reps || 20;
  form.message.value = a.message || '';
  form.sound.value = a.sound;
  $$('#dayPicker input').forEach((i) => { i.checked = a.days.includes(Number(i.value)); });
  $('#deleteAlarm').classList.toggle('hidden', !alarm);
  const del = $('#deleteAlarm'); if (del.dataset.armed) { delete del.dataset.armed; del.textContent = del.dataset.orig; }
  togglePushFields();
  $('#editDialog').showModal();
}
function togglePushFields() { $$('.pushOnly').forEach((e) => e.classList.toggle('hidden', form.type.value !== 'pushups')); }
form.type.addEventListener('change', () => {
  togglePushFields();
  const names = { pushups: 'Pushups', training: 'Training', creatine: 'Kreatin nehmen', custom: 'Erinnerung' };
  if (!editing && Object.values(names).includes(form.name.value)) form.name.value = names[form.type.value];
  form.sound.value = form.type.value === 'creatine' ? 'chime' : 'alarm';
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
    reps: Number(form.reps.value) || 0,
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
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PushUp Wecker//DE', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'X-WR-CALNAME:PushUp Wecker'];
  for (const a of alarms) {
    const start = nextOccurrence(a, now) || now;
    const end = new Date(start.getTime() + 10 * 60000);
    const t = TYPES[a.type] || TYPES.custom;
    const title = `${t.icon} ${a.name}${a.type === 'pushups' ? ` (${a.reps}×)` : ''}`;
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
  const name = alarms.length === 1 ? `wecker-${alarms[0].name.replace(/[^\w-]+/g, '_')}.ics` : 'pushup-wecker.ics';
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
    try { await navigator.share({ files: [file], title: 'PushUp Wecker' }); return; } catch (e) { if (e.name === 'AbortError') return; }
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
    try { await navigator.share({ files: [file], title: 'PushUp Wecker' }); } catch (e) { /* abgebrochen */ }
  };
}

/* ---------------- Ansicht: Verlauf ---------------- */
function renderHistory() {
  const body = $('#historyBody');
  body.innerHTML = '';
  let sum = 0, creat = 0, train = 0;
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const e = dayEntry(dateKey(d));
    sum += e.pushups; creat += e.creatine ? 1 : 0; train += e.training ? 1 : 0;
    const tr = document.createElement('tr');
    const label = i === 0 ? 'Heute' : i === 1 ? 'Gestern' : `${DAY_LABELS[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
    tr.innerHTML = `<td>${label}</td><td>${e.pushups || '–'}</td><td><span class="dot${e.creatine ? ' on' : ''}"></span></td><td><span class="dot${e.training ? ' on' : ''}"></span></td>`;
    body.appendChild(tr);
  }
  const allTime = Object.values(state.log).reduce((s, e) => s + (e.pushups || 0), 0);
  $('#stats').innerHTML = `
    <div class="stat glass"><b>${sum}</b><small>Pushups 14 Tage</small></div>
    <div class="stat glass"><b>${creat}/14</b><small>Kreatin-Tage</small></div>
    <div class="stat glass"><b>${allTime}</b><small>Pushups gesamt</small></div>`;
}

/* ---------------- Ansicht: Einstellungen ---------------- */
function renderSettings() {
  const s = state.settings;
  $('#setGoal').value = s.goal;
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
bindSetting('#setGoal', 'goal', 1, 2000);
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
  const test = { id: 'test', type: 'pushups', name: 'Test-Wecker', reps: 10, message: '10 Pushups zum Testen!', sound: 'alarm' };
  setTimeout(() => ring(test), 5000);
};

$('#backupBtn').onclick = async () => {
  if (EMBEDDED) {
    const json = JSON.stringify(state, null, 2);
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (dl) {
      try { await dl.save({ filename: `pushup-wecker-backup-${dateKey()}.json`, data: json }); toast('Backup gespeichert ✔'); return; }
      catch (e) { if (e && e.code === 'declined') return; }
    }
    const ta = $('#backupText');
    ta.value = JSON.stringify(state);
    ta.classList.remove('hidden'); ta.select();
    navigator.clipboard?.writeText(ta.value).then(() => toast('Backup kopiert ✔'), () => toast('Text markiert – kopieren und als .json speichern'));
    return;
  }
  const file = new File([JSON.stringify(state, null, 2)], `pushup-wecker-backup-${dateKey()}.json`, { type: 'application/json' });
  download(file);
};
$('#restoreInput').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.alarms) || typeof data.log !== 'object') throw new Error('Ungültig');
    state = { ...defaultState(), ...data, settings: { ...defaultState().settings, ...data.settings } };
    save(); renderAll(); toast('Backup geladen ✔');
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
  h.innerHTML = '<b>Als App installieren</b><p class="muted small">Installiere den PushUp Wecker auf deinem PC – dann läuft er in einem eigenen Fenster und startet mit einem Klick.</p><button class="btn tinted" id="installBtn">Installieren</button>';
  h.classList.remove('hidden');
  $('#installBtn').onclick = async () => { installEvent.prompt(); await installEvent.userChoice; h.classList.add('hidden'); };
});
if (isIOS() && !isStandalone() && !EMBEDDED) {
  const h = $('#installHint');
  h.innerHTML = '<b>Auf den Home-Bildschirm</b><p class="muted small">Tippe unten in Safari auf <b>Teilen</b> (□↑) → <b>Zum Home-Bildschirm</b>. Erst dann kann die App dir Mitteilungen schicken.</p>';
  h.classList.remove('hidden');
}

/* ---------------- Tabs & Start ---------------- */
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabbar button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  $('#pageTitle').textContent = TAB_TITLES[b.dataset.tab];
  renderAll();
  try { localStorage.setItem(STORE_KEY + '.tab', b.dataset.tab); } catch (e) { /* ignore */ }
}));

function renderAll() { renderToday(); renderAlarms(); renderHistory(); renderSettings(); }

function tickClock() {
  const d = new Date();
  $('#clock').textContent = hm(d);
  $('#dateLabel').textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  if (ringingAlarm) $('#ringTime').textContent = hm(d);
}

// Alte Log-Einträge (> 1 Jahr) aufräumen
(function prune() {
  const cutoff = dateKey(new Date(Date.now() - 366 * 86400000));
  for (const k of Object.keys(state.log)) if (k < cutoff) delete state.log[k];
})();

try {
  const lastTab = localStorage.getItem(STORE_KEY + '.tab');
  if (lastTab) $(`.tabbar button[data-tab="${lastTab}"]`)?.click();
} catch (e) { /* ignore */ }

// Klick auf Mitteilung öffnet App mit ?alarm=ID
const params = new URLSearchParams(location.search);
if (params.get('alarm')) {
  const a = state.alarms.find((x) => x.id === params.get('alarm'));
  if (a && params.get('action') === 'done') completeAlarm(a);
  history.replaceState(null, '', location.pathname);
}

save();
renderAll();
tickClock();
applyWakeLock();
checkAlarms();
setInterval(() => { tickClock(); checkAlarms(); }, 5000);
setInterval(renderToday, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkAlarms(); renderAll(); } });

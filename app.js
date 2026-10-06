import {dateKey, parseDate, shiftDate} from './workout-state.js';

const API_URL = 'https://script.google.com/macros/s/AKfycbzSdpqyiye1J69SupLr3uNe4OUv9CyDpaHzht3Qw2Gyf9a258zobes-K5wXG9bHwQCJ/exec';
const APP_VERSION = '0.3.1';

const DEFAULT_TEMPLATE_ID = 'andrew-ankle-rehab';
const TIMES_PER_DAY = 2;

const params = new URLSearchParams(location.search);
const user = (params.get('user') || '').trim().toLowerCase();
const $ = id => document.getElementById(id);
$('appVersion').textContent = `v${APP_VERSION}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let userData;
let dashboardData;
let selectedDate;
let selectedSessionNumber;
let selectedSession;
let openingSession = false;
let historyRequest;
let metricsVersion = 0;

function formatDate(date, options) {
  return parseDate(date).toLocaleDateString(undefined, options);
}

const CALL_LOG_KEY = `myfitnesspal:api-log:${user || 'anonymous'}`;
const MAX_CALL_LOGS = 200;
let callLogs = [];
try {
  const saved = JSON.parse(sessionStorage.getItem(CALL_LOG_KEY) || '[]');
  if (Array.isArray(saved)) callLogs = saved.slice(-MAX_CALL_LOGS);
} catch { /* Logging also works when browser storage is unavailable. */ }
let callSequence = 0;

function saveCallLogs() {
  try { sessionStorage.setItem(CALL_LOG_KEY, JSON.stringify(callLogs)); } catch {}
}

// Inspect or download timings from the browser console; no workout payloads are logged.
window.myFitnessPalLog = {
  entries: () => callLogs.map(entry => ({...entry})),
  table: () => console.table(callLogs),
  clear: () => { callLogs = []; saveCallLogs(); },
  download: () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(callLogs, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'myfitnesspal-call-log.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
};

async function apiRequest(action, method, url, options) {
  const started = performance.now();
  const entry = {
    id: `${Date.now()}-${++callSequence}`,
    action, method, version: APP_VERSION, startedAt: new Date().toISOString(), outcome: 'pending'
  };
  callLogs.push(entry);
  callLogs = callLogs.slice(-MAX_CALL_LOGS);
  saveCallLogs();
  console.debug('[myFitnessPal API] start', {...entry});
  try {
    const response = await fetch(url, options);
    entry.status = response.status;
    if (!response.ok) throw new Error(`Backend request failed (${response.status}).`);
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || 'Backend request failed.');
    entry.outcome = 'success';
    return payload.data;
  } catch (error) {
    entry.outcome = 'error';
    throw error;
  } finally {
    entry.finishedAt = new Date().toISOString();
    entry.durationMs = Math.round(performance.now() - started);
    saveCallLogs();
    console.debug('[myFitnessPal API] end', {...entry});
  }
}

async function apiGet(action, query = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  return apiRequest(action, 'GET', url, {cache: 'no-store'});
}

async function apiPost(action, body = {}) {
  const data = await apiRequest(action, 'POST', API_URL, {
    method: 'POST',
    body: JSON.stringify({action, ...body})
  });
  historyRequest = null;
  return data;
}

function updateUrl(session = null) {
  const url = new URL(location.href);
  url.searchParams.set('user', user);
  url.searchParams.set('date', selectedDate);
  session ? url.searchParams.set('session', session) : url.searchParams.delete('session');
  history.replaceState(null, '', url);
}

function sessionsForSelectedDate() {
  return dashboardData?.sessions || [];
}

function sessionForSlot(slot) {
  return sessionsForSelectedDate()[slot - 1] || null;
}

function countCompleted(session) {
  return (session?.items || []).filter(item => item.completed === true || String(item.completed).toLowerCase() === 'true').length;
}

function sessionDone(session) {
  return !!session && session.status === 'completed';
}

async function loadDashboard(date = selectedDate) {
  dashboardData = await apiGet('dashboard', {user, date});
  return dashboardData;
}

async function refreshMetrics() {
  const version = ++metricsVersion;
  const today = dateKey();
  const allRequest = historyRequest ||= apiGet('sessions', {user}).catch(error => {
    historyRequest = null;
    throw error;
  });
  // Attach a handler immediately while today's data loads.
  const historyResult = allRequest.then(data => ({data}), error => ({error}));
  const todayData = selectedDate === today ? dashboardData : await apiGet('dashboard', {user, date: today});
  const todaySessions = todayData.sessions || [];
  const totalExercises = todaySessions.reduce((sum, session) => sum + (session.items?.length || 0), 0);
  const completedExercises = todaySessions.reduce((sum, session) => sum + countCompleted(session), 0);
  const completedSessions = todaySessions.filter(sessionDone).length;

  let weekCompleted = 0;
  try {
    const result = await historyResult;
    if (result.error) throw result.error;
    const all = result.data;
    const weekDates = new Set(Array.from({length: 7}, (_, i) => shiftDate(today, -i)));
    weekCompleted = (all.sessions || []).filter(session =>
      weekDates.has(String(session.session_date).slice(0, 10)) && session.status === 'completed'
    ).length;
  } catch {
    weekCompleted = completedSessions;
  }

  if (version !== metricsVersion) return;
  $('todaySessions').textContent = `${completedSessions} / ${TIMES_PER_DAY}`;
  $('todayExercises').textContent = `${completedExercises} / ${totalExercises || 14}`;
  $('weekSessions').textContent = `${weekCompleted} / ${7 * TIMES_PER_DAY}`;
}

async function renderDashboard() {
  void refreshMetrics().catch(() => {
    // Workout navigation remains available if metrics fail.
  });

  $('selectedDateLabel').textContent = formatDate(selectedDate, {weekday:'long',month:'long',day:'numeric',year:'numeric'});
  $('datePicker').value = selectedDate;

  $('dateRoller').innerHTML = Array.from({length:15}, (_, i) => {
    const date = shiftDate(selectedDate, i - 7);
    return `<button class="date-button ${date === dateKey() ? 'today' : ''}" data-date="${date}" aria-pressed="${date === selectedDate}" aria-label="${esc(formatDate(date, {weekday:'long',month:'long',day:'numeric',year:'numeric'}))}"><span>${esc(formatDate(date, {weekday:'short'}))}</span><strong>${parseDate(date).getDate()}</strong><span>${date === dateKey() ? 'Today' : esc(formatDate(date, {month:'short'}))}</span></button>`;
  }).join('');

  $('dateRoller').querySelectorAll('button').forEach(button =>
    button.addEventListener('click', () => chooseDate(button.dataset.date))
  );

  requestAnimationFrame(() => {
    const selected = $('dateRoller').querySelector('[aria-pressed=true]');
    if (selected) $('dateRoller').scrollLeft = selected.offsetLeft - ($('dateRoller').clientWidth - selected.clientWidth) / 2;
  });

  $('sessions').innerHTML = Array.from({length: TIMES_PER_DAY}, (_, i) => {
    const slot = i + 1;
    const session = sessionForSlot(slot);
    const count = countCompleted(session);
    const total = session?.items?.length || 7;
    const done = sessionDone(session);
    const status = done ? 'Complete' : count ? 'Continue' : 'Start';
    return `<button class="session-card ${done ? 'complete' : ''}" data-session="${slot}"><span class="session-icon" aria-hidden="true">${done ? '✓' : '›'}</span><span class="session-copy"><strong>Session ${slot}</strong><span>Andrew Ankle Rehab · ${count} / ${total} complete</span></span><span class="session-status">${status}</span></button>`;
  }).join('');

  $('sessions').querySelectorAll('button').forEach(button =>
    button.addEventListener('click', () => openSession(Number(button.dataset.session)))
  );
}

async function chooseDate(date) {
  if (!parseDate(date)) return;
  selectedDate = date;
  $('message').hidden = false;
  $('message').textContent = 'Loading workouts…';
  await loadDashboard(selectedDate);
  updateUrl();
  await renderDashboard();
  $('message').hidden = true;
}

async function ensureSession(slot) {
  let sessions = sessionsForSelectedDate();

  while (sessions.length < slot) {
    const created = await apiPost('createSession', {
      user_id: userData.user_id,
      template_id: DEFAULT_TEMPLATE_ID,
      session_date: selectedDate
    });
    // Most writes return the full session; avoid reading it again.
    const record = created?.session || created;
    if (record?.session_id && Array.isArray(record.items)) {
      sessions.push(record);
    } else {
      await loadDashboard(selectedDate);
      sessions = sessionsForSelectedDate();
    }
  }

  return sessions[slot - 1];
}

function itemPrescription(item) {
  const p = item.prescription || {};
  if (p.notes) return p.notes;
  const parts = [];
  if (p.sets) parts.push(`${p.sets} sets`);
  if (p.reps) parts.push(`${p.reps} reps`);
  if (p.duration_sec) parts.push(`${p.duration_sec} sec`);
  return parts.join(' · ');
}

function itemImages(item) {
  return (item.steps || [])
    .filter(step => step.image_url)
    .map(step => ({src: step.image_url, alt: `${item.title} exercise illustration`}));
}

function renderWorkout() {
  const items = selectedSession.items || [];
  const complete = countCompleted(selectedSession);

  $('dashboard').hidden = true;
  $('workout').hidden = false;
  $('workoutTitle').textContent = selectedSession.template_id === DEFAULT_TEMPLATE_ID ? 'Andrew Ankle Rehab' : 'Workout';
  $('sessionLabel').textContent = `${formatDate(selectedDate, {month:'short',day:'numeric',year:'numeric'})} · Session ${selectedSessionNumber} of ${TIMES_PER_DAY}`;

  $('list').innerHTML = items.map(item => {
    const checked = item.completed === true || String(item.completed).toLowerCase() === 'true';
    const exercise = item.exercise || {};
    const prescription = itemPrescription(item);
    const steps = item.steps || [];
    const images = itemImages(item);

    return `<section class="item ${checked ? 'done' : ''}" data-id="${esc(item.session_item_id)}">
      <div class="row">
        <label class="check-label">
          <input class="check" type="checkbox" ${checked ? 'checked' : ''}>
          <span class="sr-only">Complete ${esc(item.title)}</span>
        </label>
        <details class="exercise">
          <summary>
            ${item.thumbnail_url ? `<img class="thumb" src="${esc(item.thumbnail_url)}" alt="" loading="lazy">` : '<span class="thumb" aria-hidden="true">🦶</span>'}
            <span><span class="name">${esc(item.title)}</span><span class="meta">${esc(prescription)}</span></span>
            <span class="chev" aria-hidden="true">⌄</span>
          </summary>
          <div class="detail">
            ${exercise.summary ? `<p>${esc(exercise.summary)}</p>` : ''}
            ${prescription ? `<strong>${esc(prescription)}</strong>` : ''}
            <ol class="steps">${steps.map(step => `<li>${esc(step.instruction)}</li>`).join('')}</ol>
            ${exercise.notes ? `<p>${esc(exercise.notes)}</p>` : ''}
            ${images.map(img => `<img class="detail-image" src="${esc(img.src)}" alt="${esc(img.alt)}" loading="lazy">`).join('')}
            <p class="source-label">From Andrew’s exercise sheet</p>
          </div>
        </details>
      </div>
    </section>`;
  }).join('');

  $('list').querySelectorAll('input').forEach(input => input.addEventListener('change', async () => {
    const row = input.closest('.item');
    input.disabled = true;
    try {
      selectedSession = await apiPost('checkItem', {
        session_item_id: row.dataset.id,
        completed: input.checked
      });
      refreshChecklist();

      if (selectedSession.progress?.percent === 100 && selectedSession.status !== 'completed') {
        selectedSession = await apiPost('completeSession', {session_id: selectedSession.session_id});
        refreshChecklist();
      }
    } catch (error) {
      input.checked = !input.checked;
      $('message').hidden = false;
      $('message').textContent = error.message;
    } finally {
      input.disabled = false;
    }
  }));

  refreshChecklist();
  updateUrl(selectedSessionNumber);
  window.scrollTo(0, 0);
}

function refreshChecklist() {
  const items = selectedSession?.items || [];
  const complete = countCompleted(selectedSession);
  const percentage = items.length ? Math.round(100 * complete / items.length) : 0;
  $('count').textContent = `${complete} / ${items.length} complete`;
  $('bar').style.width = `${percentage}%`;
  $('bar').parentElement.setAttribute('aria-valuenow', percentage);

  for (const item of $('list').querySelectorAll('.item')) {
    const record = items.find(value => value.session_item_id === item.dataset.id);
    const done = !!record && (record.completed === true || String(record.completed).toLowerCase() === 'true');
    item.classList.toggle('done', done);
    const checkbox = item.querySelector('input');
    if (checkbox) checkbox.checked = done;
  }
}

async function openSession(slot) {
  if (openingSession) return;
  openingSession = true;
  selectedSessionNumber = slot;
  $('message').hidden = false;
  $('message').textContent = 'Loading session…';

  try {
    selectedSession = await ensureSession(slot);

    renderWorkout();
    $('message').hidden = true;

    if (selectedSession.status === 'scheduled') {
      // Show exercise details while the start event is saved.
      $('backButton').disabled = true;
      $('list').querySelectorAll('input').forEach(input => input.disabled = true);
      $('saveNotice').textContent = 'Starting session…';
      selectedSession = await apiPost('startSession', {session_id: selectedSession.session_id});
      refreshChecklist();
      $('saveNotice').textContent = 'Progress is saved to the workout backend.';
    }
  } catch (error) {
    $('message').hidden = false;
    $('message').textContent = error.message;
    $('saveNotice').textContent = 'Session could not be started. Return to the dashboard to retry.';
    return;
  } finally {
    openingSession = false;
    $('backButton').disabled = false;
  }
  $('list').querySelectorAll('input').forEach(input => input.disabled = false);
}

async function showDashboard() {
  $('workout').hidden = true;
  $('dashboard').hidden = false;
  // Writes already return current session data. Reuse it on Back.
  if (selectedSession) {
    const sessions = sessionsForSelectedDate();
    const index = sessions.findIndex(session => session.session_id === selectedSession.session_id);
    if (index >= 0) sessions[index] = selectedSession;
  }
  updateUrl();
  await renderDashboard();
  $('message').hidden = true;
  window.scrollTo(0, 0);
}

async function load() {
  if (!user) {
    $('message').innerHTML = 'Choose a user to view their dashboard. <a href="?user=andrew.hunter">Open Andrew’s dashboard</a>';
    return;
  }

  try {
    selectedDate = parseDate(params.get('date')) ? params.get('date') : dateKey();
    [userData] = await Promise.all([apiGet('user', {user}), loadDashboard(selectedDate)]);

    $('userName').textContent = userData.display_name;
    $('dashboardTitle').textContent = `${userData.display_name}’s workouts`;
    document.querySelector('.pill').textContent = `Daily · ${TIMES_PER_DAY} sessions`;
    document.title = `${userData.display_name} · myFitnessPal`;
    $('saveNotice').textContent = 'Progress is saved to the workout backend.';

    $('todayButton').addEventListener('click', () => chooseDate(dateKey()));
    $('previousDate').addEventListener('click', () => chooseDate(shiftDate(selectedDate, -1)));
    $('nextDate').addEventListener('click', () => chooseDate(shiftDate(selectedDate, 1)));
    $('datePicker').addEventListener('change', event => chooseDate(event.target.value));
    $('backButton').addEventListener('click', showDashboard);

    $('message').hidden = true;
    $('dashboard').hidden = false;
    await renderDashboard();

    const session = Number(params.get('session'));
    if (Number.isInteger(session) && session >= 1 && session <= TIMES_PER_DAY) {
      await openSession(session);
    }
  } catch (error) {
    $('message').hidden = false;
    $('message').textContent = `${error.message} Please reload to try again.`;
  }
}

load();


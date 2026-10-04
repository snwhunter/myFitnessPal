import {dateKey, parseDate, shiftDate} from './workout-state.js';

const API_URL = 'https://script.google.com/macros/s/AKfycbzSdpqyiye1J69SupLr3uNe4OUv9CyDpaHzht3Qw2Gyf9a258zobes-K5wXG9bHwQCJ/exec';
const DEFAULT_TEMPLATE_ID = 'andrew-ankle-rehab';
const TIMES_PER_DAY = 2;

const params = new URLSearchParams(location.search);
const user = (params.get('user') || '').trim().toLowerCase();
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let userData;
let dashboardData;
let selectedDate;
let selectedSessionNumber;
let selectedSession;

function formatDate(date, options) {
  return parseDate(date).toLocaleDateString(undefined, options);
}

async function apiGet(action, query = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error(`Backend request failed (${response.status}).`);
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'Backend request failed.');
  return payload.data;
}

async function apiPost(action, body = {}) {
  const response = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify({action, ...body})
  });
  if (!response.ok) throw new Error(`Backend request failed (${response.status}).`);
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'Backend request failed.');
  return payload.data;
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
  const today = dateKey();
  const todayData = selectedDate === today ? dashboardData : await apiGet('dashboard', {user, date: today});
  const todaySessions = todayData.sessions || [];
  const totalExercises = todaySessions.reduce((sum, session) => sum + (session.items?.length || 0), 0);
  const completedExercises = todaySessions.reduce((sum, session) => sum + countCompleted(session), 0);
  const completedSessions = todaySessions.filter(sessionDone).length;

  let weekCompleted = 0;
  try {
    const all = await apiGet('sessions', {user});
    const weekDates = new Set(Array.from({length: 7}, (_, i) => shiftDate(today, -i)));
    weekCompleted = (all.sessions || []).filter(session =>
      weekDates.has(String(session.session_date).slice(0, 10)) && session.status === 'completed'
    ).length;
  } catch {
    weekCompleted = completedSessions;
  }

  $('todaySessions').textContent = `${completedSessions} / ${TIMES_PER_DAY}`;
  $('todayExercises').textContent = `${completedExercises} / ${totalExercises || 14}`;
  $('weekSessions').textContent = `${weekCompleted} / ${7 * TIMES_PER_DAY}`;
}

async function renderDashboard() {
  await refreshMetrics();

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
    await apiPost('createSession', {
      user_id: userData.user_id,
      template_id: DEFAULT_TEMPLATE_ID,
      session_date: selectedDate
    });
    await loadDashboard(selectedDate);
    sessions = sessionsForSelectedDate();
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
  selectedSessionNumber = slot;
  $('message').hidden = false;
  $('message').textContent = 'Loading session…';

  try {
    selectedSession = await ensureSession(slot);

    if (selectedSession.status === 'scheduled') {
      selectedSession = await apiPost('startSession', {session_id: selectedSession.session_id});
    }

    renderWorkout();
    $('message').hidden = true;
  } catch (error) {
    $('message').textContent = error.message;
  }
}

async function showDashboard() {
  $('workout').hidden = true;
  $('dashboard').hidden = false;
  $('message').hidden = false;
  $('message').textContent = 'Refreshing workouts…';
  await loadDashboard(selectedDate);
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
    userData = await apiGet('user', {user});
    selectedDate = parseDate(params.get('date')) ? params.get('date') : dateKey();
    await loadDashboard(selectedDate);

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

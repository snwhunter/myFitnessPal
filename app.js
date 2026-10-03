import {dateKey, parseDate, shiftDate, storageKey, readCompletion} from './workout-state.js';
const sources = {'andrew.hunter': 'data/andrew-ankle-rehab.json'};
const params = new URLSearchParams(location.search);
const user = (params.get('user') || '').trim().toLowerCase();
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data, ids, selectedDate, selectedSession, complete;
let storage, storageAvailable = true;
try { storage = window.localStorage; storage.setItem('myfitnesspal:storage-test', '1'); storage.removeItem('myfitnesspal:storage-test'); }
catch { storageAvailable = false; }
const memory = new Map();
const progressStorage = {
  getItem(key) { if (memory.has(key)) return memory.get(key); try { return storage?.getItem(key) ?? null; } catch { return null; } },
  setItem(key, value) { memory.set(key, value); try { if (!storageAvailable) throw new Error(); storage.setItem(key, value); } catch { storageAvailable = false; showStorageNotice(); } }
};
function showStorageNotice() { $('saveNotice').textContent = storageAvailable ? 'Progress is saved on this device.' : 'Device storage is unavailable. Progress lasts only while this page is open.'; }
function key(date, session) { return storageKey(user, data.workout.workout_id, date, session); }
function read(date, session) { return readCompletion(progressStorage, key(date, session), ids); }
function formatDate(date, options) { return parseDate(date).toLocaleDateString(undefined, options); }
function refreshMetrics() {
  const today = dateKey();
  let sessions = 0, exercises = 0, week = 0;
  for (let i = 1; i <= data.workout.times_per_day; i++) {
    const count = read(today, i).size;
    exercises += count;
    if (count === ids.length && ids.length) sessions++;
  }
  for (let day = -6; day <= 0; day++) for (let i = 1; i <= data.workout.times_per_day; i++) {
    if (ids.length && read(shiftDate(today, day), i).size === ids.length) week++;
  }
  $('todaySessions').textContent = `${sessions} / ${data.workout.times_per_day}`;
  $('todayExercises').textContent = `${exercises} / ${ids.length * data.workout.times_per_day}`;
  $('weekSessions').textContent = `${week} / ${7 * data.workout.times_per_day}`;
}
function updateUrl(session = null) {
  const url = new URL(location.href);
  url.searchParams.set('user', user);
  url.searchParams.set('date', selectedDate);
  session ? url.searchParams.set('session', session) : url.searchParams.delete('session');
  history.replaceState(null, '', url);
}
function renderDashboard() {
  refreshMetrics();
  $('selectedDateLabel').textContent = formatDate(selectedDate, {weekday:'long',month:'long',day:'numeric',year:'numeric'});
  $('datePicker').value = selectedDate;
  $('dateRoller').innerHTML = Array.from({length:15}, (_, i) => {
    const date = shiftDate(selectedDate, i - 7);
    return `<button class="date-button ${date === dateKey() ? 'today' : ''}" data-date="${date}" aria-pressed="${date === selectedDate}" aria-label="${esc(formatDate(date, {weekday:'long',month:'long',day:'numeric',year:'numeric'}))}"><span>${esc(formatDate(date, {weekday:'short'}))}</span><strong>${parseDate(date).getDate()}</strong><span>${date === dateKey() ? 'Today' : esc(formatDate(date, {month:'short'}))}</span></button>`;
  }).join('');
  $('dateRoller').querySelectorAll('button').forEach(button => button.addEventListener('click', () => chooseDate(button.dataset.date)));
  requestAnimationFrame(() => {
    const selected = $('dateRoller').querySelector('[aria-pressed=true]');
    $('dateRoller').scrollLeft = selected.offsetLeft - ($('dateRoller').clientWidth - selected.clientWidth) / 2;
  });
  $('sessions').innerHTML = Array.from({length:data.workout.times_per_day}, (_, i) => {
    const session = i + 1, count = read(selectedDate, session).size, done = ids.length > 0 && count === ids.length;
    return `<button class="session-card ${done ? 'complete' : ''}" data-session="${session}"><span class="session-icon" aria-hidden="true">${done ? '✓' : '›'}</span><span class="session-copy"><strong>Session ${session}</strong><span>${esc(data.workout.title)} · ${count} / ${ids.length} complete</span></span><span class="session-status">${done ? 'Complete' : count ? 'Continue' : 'Start'}</span></button>`;
  }).join('');
  $('sessions').querySelectorAll('button').forEach(button => button.addEventListener('click', () => openSession(Number(button.dataset.session))));
}
function chooseDate(date) {
  if (!parseDate(date)) return;
  selectedDate = date;
  updateUrl();
  renderDashboard();
}
function refreshChecklist() {
  $('count').textContent = `${complete.size} / ${ids.length} complete`;
  const percentage = ids.length ? Math.round(100 * complete.size / ids.length) : 0;
  $('bar').style.width = `${percentage}%`;
  $('bar').parentElement.setAttribute('aria-valuenow', percentage);
  for (const item of $('list').querySelectorAll('.item')) item.classList.toggle('done', complete.has(item.dataset.id));
}
function openSession(session) {
  selectedSession = session;
  complete = read(selectedDate, session);
  $('dashboard').hidden = true;
  $('workout').hidden = false;
  $('workoutTitle').textContent = data.workout.title;
  $('sessionLabel').textContent = `${formatDate(selectedDate, {month:'short',day:'numeric',year:'numeric'})} · Session ${session} of ${data.workout.times_per_day}`;
  $('list').innerHTML = data.activities.map(activity => `<section class="item" data-id="${esc(activity.activity_id)}"><div class="row"><label class="check-label"><input class="check" type="checkbox" ${complete.has(activity.activity_id) ? 'checked' : ''}><span class="sr-only">Complete ${esc(activity.title)}</span></label><details class="exercise"><summary>${activity.thumbnail ? `<img class="thumb" src="${esc(activity.thumbnail)}" alt="" loading="lazy">` : '<span class="thumb" aria-hidden="true">🦶</span>'}<span><span class="name">${esc(activity.title)}</span><span class="meta">${esc(activity.prescription)}</span></span><span class="chev" aria-hidden="true">⌄</span></summary><div class="detail">${activity.purpose ? `<p>${esc(activity.purpose)}</p>` : ''}<strong>${esc(activity.prescription)}</strong><ol class="steps">${activity.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>${activity.notes ? `<p>${esc(activity.notes)}</p>` : ''}${(activity.images || []).map(img => `<img class="detail-image" src="${esc(img.src)}" alt="${esc(img.alt)}" loading="lazy">`).join('')}<p class="source-label">From Andrew’s exercise sheet</p></div></details></div></section>`).join('');
  $('list').querySelectorAll('input').forEach(input => input.addEventListener('change', () => {
    const id = input.closest('.item').dataset.id;
    input.checked ? complete.add(id) : complete.delete(id);
    progressStorage.setItem(key(selectedDate, selectedSession), JSON.stringify([...complete]));
    refreshChecklist();
  }));
  refreshChecklist();
  updateUrl(session);
  window.scrollTo(0, 0);
}
function showDashboard() {
  $('workout').hidden = true;
  $('dashboard').hidden = false;
  updateUrl();
  renderDashboard();
  window.scrollTo(0, 0);
}
async function load() {
  if (!sources[user]) {
    $('message').innerHTML = 'Choose a user to view their dashboard. <a href="?user=andrew.hunter">Open Andrew’s dashboard</a>';
    return;
  }
  try {
    const response = await fetch(sources[user], {cache:'no-store'});
    if (!response.ok) throw new Error('Workout data is unavailable.');
    data = await response.json();
    data.activities.sort((a,b) => a.order - b.order);
    ids = data.activities.map(activity => activity.activity_id);
    selectedDate = parseDate(params.get('date')) ? params.get('date') : dateKey();
    // Retain undated prototype progress once, on the upgrade day only.
    for (let session = 1; session <= data.workout.times_per_day; session++) {
      const legacyKey = `myfitnesspal:${user}:${data.workout.workout_id}:session:${session}`;
      const migrationKey = `${legacyKey}:migrated-to-date`;
      const legacy = progressStorage.getItem(legacyKey);
      if (legacy && !progressStorage.getItem(migrationKey)) {
        if (!progressStorage.getItem(key(dateKey(), session))) progressStorage.setItem(key(dateKey(), session), JSON.stringify([...readCompletion(progressStorage, legacyKey, ids)]));
        progressStorage.setItem(migrationKey, dateKey());
      }
    }
    $('userName').textContent = data.user.name;
    $('dashboardTitle').textContent = `${data.user.name}’s workouts`;
    document.querySelector('.pill').textContent = `Daily · ${data.workout.times_per_day} sessions`;
    document.title = `${data.user.name} · myFitnessPal`;
    $('message').hidden = true;
    showStorageNotice();
    $('todayButton').addEventListener('click', () => chooseDate(dateKey()));
    $('previousDate').addEventListener('click', () => chooseDate(shiftDate(selectedDate, -1)));
    $('nextDate').addEventListener('click', () => chooseDate(shiftDate(selectedDate, 1)));
    $('datePicker').addEventListener('change', event => chooseDate(event.target.value));
    $('backButton').addEventListener('click', showDashboard);
    window.addEventListener('storage', () => {
      memory.clear();
      if (!$('dashboard').hidden) renderDashboard();
      else {
        complete = read(selectedDate, selectedSession);
        $('list').querySelectorAll('input').forEach(input => { input.checked = complete.has(input.closest('.item').dataset.id); });
        refreshChecklist();
      }
    });
    showDashboard();
    const session = Number(params.get('session'));
    if (Number.isInteger(session) && session >= 1 && session <= data.workout.times_per_day) openSession(session);
  } catch (error) { $('message').textContent = `${error.message} Please reload to try again.`; }
}
load();

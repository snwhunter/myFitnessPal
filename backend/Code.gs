/***************************************************************
 * myFitnessPal Backend API
 * Bound Google Apps Script for:
 * myFitnessPal Backend
 *
 * Deploy as:
 *   Deploy -> New deployment -> Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * GET examples:
 *   ?action=health
 *   ?action=user&user=andrew.hunter
 *   ?action=sessions&user=USR-0001
 *   ?action=sessions&user=USR-0001&date=2026-10-03
 *   ?action=session&session_id=SES-...
 *   ?action=dashboard&user=andrew.hunter&date=2026-10-03
 *
 * POST JSON examples are below in the router.
 ***************************************************************/
const APP = {
  SOURCE: 'myFitnessPal-web',
  VERSION: '0.3.3',
  SHEETS: {
    USERS: 'Users',
    EXERCISES: 'Exercises',
    EXERCISE_STEPS: 'ExerciseSteps',
    MEDIA: 'Media',
    WORKOUT_TEMPLATES: 'WorkoutTemplates',
    WORKOUT_TEMPLATE_ITEMS: 'WorkoutTemplateItems',
    SCHEDULE: 'Schedule',
    SESSIONS: 'Sessions',
    SESSION_ITEMS: 'SessionItems',
    METRICS: 'Metrics',
    LOGS: 'Logs',
    CONFIG: 'Config'
  }
};
/* ============================================================
 * ENTRY POINTS
 * ============================================================ */
// These caches live for one request only. Writes invalidate affected tables.
let requestDb_;
function resetRequestDb_() {
  requestDb_ = {sheets: {}, rows: {}, headers: {}, reads: {}};
}
function requestDbContext_() {
  if (!requestDb_) resetRequestDb_();
  return requestDb_;
}
function invalidateRows_(sheetName) {
  delete requestDbContext_().rows[sheetName];
}

function doGet(e) {
  resetRequestDb_();
  const started = Date.now();
  try {
    const params = (e && e.parameter) || {};
    const action = String(params.action || 'health').trim();
    let result;
    switch (action) {
      case 'health':
        result = apiHealth_();
        break;
      case 'user':
        result = apiGetUser_(params);
        break;
      case 'dashboard':
        result = apiDashboard_(params);
        break;
      case 'sessions':
        result = apiGetSessions_(params);
        break;
      case 'session':
        result = apiGetSession_(params);
        break;
      case 'exercises':
        result = apiGetExercises_(params);
        break;
      case 'exercise':
        result = apiGetExercise_(params);
        break;
      case 'templates':
        result = apiGetTemplates_(params);
        break;
      case 'template':
        result = apiGetTemplate_(params);
        break;
      case 'metrics':
        result = apiGetMetrics_(params);
        break;
      default:
        throw new Error('Unknown GET action: ' + action);
    }
    logEvent_({
      event_name: 'api_get',
      user_id: result.user_id || params.user || '',
      record_type: action,
      record_id: result.session_id || result.template_id || result.exercise_id || '',
      severity: 'info',
      message: 'GET ' + action,
      payload: {
        elapsed_ms: Date.now() - started,
        sheet_reads: requestDbContext_().reads,
        backend_version: APP.VERSION,
        params: params
      }
    });
    return jsonResponse_({
      ok: true,
      backend_version: APP.VERSION,
      action: action,
      data: result
    });
  } catch (err) {
    logError_('api_get_error', err, {
      params: (e && e.parameter) || {}
    });
    return jsonResponse_({
      ok: false,
      error: err.message
    });
  }
}
function doPost(e) {
  resetRequestDb_();
  const started = Date.now();
  let writeLock;
  try {
    const body = parseJsonBody_(e);
    const action = String(body.action || '').trim();
    if (!action) {
      throw new Error('POST body requires action');
    }
    writeLock = LockService.getScriptLock();
    if (!writeLock.tryLock(30000)) throw new Error('Another update is in progress. Please try again.');
    // Read only after obtaining the lock so retries see the latest saved state.
    resetRequestDb_();
    let result;
    switch (action) {
      case 'startSession':
        result = apiStartSession_(body);
        break;
      case 'checkItem':
        result = apiCheckItem_(body);
        break;
      case 'completeSession':
        result = apiCompleteSession_(body);
        break;
      case 'skipSession':
        result = apiSkipSession_(body);
        break;
      case 'saveMetric':
        result = apiSaveMetric_(body);
        break;
      case 'createSession':
        result = apiCreateSession_(body);
        break;
      default:
        throw new Error('Unknown POST action: ' + action);
    }
    logEvent_({
      event_name: 'api_post',
      user_id: body.user_id || '',
      record_type: action,
      record_id: result.session_id || result.metric_id || '',
      severity: 'info',
      message: 'POST ' + action,
      payload: {
        elapsed_ms: Date.now() - started,
        sheet_reads: requestDbContext_().reads,
        backend_version: APP.VERSION
      }
    });
    return jsonResponse_({
      ok: true,
      backend_version: APP.VERSION,
      action: action,
      data: result
    });
  } catch (err) {
    logError_('api_post_error', err, {
      body: safeParseBody_(e)
    });
    return jsonResponse_({
      ok: false,
      error: err.message
    });
  } finally {
    if (writeLock && writeLock.hasLock()) {
      try { SpreadsheetApp.flush(); } finally { writeLock.releaseLock(); }
    }
  }
}
/* ============================================================
 * GET API
 * ============================================================ */
function apiHealth_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    status: 'ok',
    backend_version: APP.VERSION,
    spreadsheet_id: ss.getId(),
    spreadsheet_name: ss.getName(),
    timezone: getConfig_('timezone') || Session.getScriptTimeZone(),
    schema_version: getConfig_('schema_version') || ''
  };
}
function apiGetUser_(params) {
  const user = resolveUser_(params.user || params.user_id);
  if (!user) {
    throw new Error('User not found');
  }
  return user;
}
function apiDashboard_(params) {
  const user = resolveUser_(params.user || params.user_id);
  if (!user) {
    throw new Error('User not found');
  }
  const date = normalizeDate_(params.date || today_());
  const scheduleRows = findRows_(APP.SHEETS.SCHEDULE, row =>
    row.user_id === user.user_id &&
    normalizeDate_(row.scheduled_date) === date
  );
  const sessions = findRows_(APP.SHEETS.SESSIONS, row =>
    row.user_id === user.user_id &&
    normalizeDate_(row.session_date) === date
  );
  const sessionResults = sessions.map(s => buildSessionResponse_(s));
  const metrics = findRows_(APP.SHEETS.METRICS, row =>
    row.user_id === user.user_id &&
    normalizeDate_(row.metric_date) === date
  );
  return {
    user: user,
    user_id: user.user_id,
    date: date,
    schedule: scheduleRows,
    sessions: sessionResults,
    metrics: metrics
  };
}
function apiGetSessions_(params) {
  const user = resolveUser_(params.user || params.user_id);
  if (!user) {
    throw new Error('User not found');
  }
  const date = params.date ? normalizeDate_(params.date) : null;
  let rows = findRows_(APP.SHEETS.SESSIONS, row => {
    if (row.user_id !== user.user_id) return false;
    if (date && normalizeDate_(row.session_date) !== date) {
      return false;
    }
    return true;
  });
  rows.sort((a, b) =>
    String(b.session_date).localeCompare(String(a.session_date))
  );
  return {
    user_id: user.user_id,
    sessions: rows.map(isTrue_(params.summary) ? buildSessionSummary_ : buildSessionResponse_)
  };
}
function apiGetSession_(params) {
  const sessionId = required_(params.session_id, 'session_id');
  const session = findOne_(
    APP.SHEETS.SESSIONS,
    row => row.session_id === sessionId
  );
  if (!session) {
    throw new Error('Session not found: ' + sessionId);
  }
  return buildSessionResponse_(session);
}
function apiGetExercises_(params) {
  let rows = getRows_(APP.SHEETS.EXERCISES);
  rows = rows.filter(row => isTrue_(row.active));
  if (params.category) {
    rows = rows.filter(row => row.category === params.category);
  }
  return {
    exercises: rows
  };
}
function apiGetExercise_(params) {
  const exerciseId = required_(params.exercise_id, 'exercise_id');
  const exercise = findOne_(
    APP.SHEETS.EXERCISES,
    row => row.exercise_id === exerciseId
  );
  if (!exercise) {
    throw new Error('Exercise not found: ' + exerciseId);
  }
  const steps = findRows_(
    APP.SHEETS.EXERCISE_STEPS,
    row => row.exercise_id === exerciseId && isTrue_(row.active)
  );
  steps.sort((a, b) =>
    Number(a.step_order || 0) - Number(b.step_order || 0)
  );
  const media = findRows_(
    APP.SHEETS.MEDIA,
    row =>
      row.entity_type === 'exercise' &&
      row.entity_id === exerciseId &&
      isTrue_(row.active)
  );
  media.sort((a, b) =>
    Number(a.sort_order || 0) - Number(b.sort_order || 0)
  );
  return {
    exercise_id: exerciseId,
    exercise: exercise,
    steps: steps,
    media: media
  };
}
function apiGetTemplates_(params) {
  let rows = getRows_(APP.SHEETS.WORKOUT_TEMPLATES);
  rows = rows.filter(row => isTrue_(row.active));
  return {
    templates: rows
  };
}
function apiGetTemplate_(params) {
  const templateId = required_(params.template_id, 'template_id');
  return buildTemplateResponse_(templateId);
}
function apiGetMetrics_(params) {
  const user = resolveUser_(params.user || params.user_id);
  if (!user) {
    throw new Error('User not found');
  }
  let rows = findRows_(
    APP.SHEETS.METRICS,
    row => row.user_id === user.user_id
  );
  if (params.metric_type) {
    rows = rows.filter(row =>
      row.metric_type === params.metric_type
    );
  }
  return {
    user_id: user.user_id,
    metrics: rows
  };
}
/* ============================================================
 * POST API
 * ============================================================ */
function apiCreateSession_(body) {
  const user = resolveUser_(body.user || body.user_id);
  if (!user) {
    throw new Error('User not found');
  }
  const templateId = required_(body.template_id, 'template_id');
  const template = findOne_(
    APP.SHEETS.WORKOUT_TEMPLATES,
    row => row.template_id === templateId
  );
  if (!template) {
    throw new Error('Template not found: ' + templateId);
  }
  const date = normalizeDate_(body.session_date || today_());
  const existing = findRows_(APP.SHEETS.SESSIONS, row =>
    row.user_id === user.user_id && row.template_id === templateId &&
    normalizeDate_(row.session_date) === date);
  // Stable physical row order matches the dashboard slot order.
  existing.sort((a, b) => a._row - b._row);
  const limit = Number(template.times_per_day) || 2;
  const slot = body.session_number === undefined ? Math.min(existing.length + 1, limit) : Number(body.session_number);
  if (!Number.isInteger(slot) || slot < 1 || slot > limit) {
    throw new Error('session_number must be between 1 and ' + limit);
  }
  // The POST lock makes this check and creation atomic across tabs/devices.
  if (existing[slot - 1]) return buildSessionResponse_(existing[slot - 1]);
  if (slot !== existing.length + 1) throw new Error('Create earlier session slots first.');
  const sessionId = makeId_('SES');
  appendObject_(APP.SHEETS.SESSIONS, {
    session_id: sessionId,
    user_id: user.user_id,
    template_id: templateId,
    schedule_id: body.schedule_id || '',
    session_date: date,
    started_at: '',
    completed_at: '',
    status: 'scheduled',
    overall_notes: body.notes || ''
  });
  const templateItems = findRows_(
    APP.SHEETS.WORKOUT_TEMPLATE_ITEMS,
    row => row.template_id === templateId
  );
  templateItems.sort((a, b) =>
    Number(a.item_order || 0) - Number(b.item_order || 0)
  );
  appendObjects_(APP.SHEETS.SESSION_ITEMS, templateItems.map(item => ({
      session_item_id: makeId_('SIT'),
      session_id: sessionId,
      template_item_id: item.template_item_id,
      exercise_id: item.exercise_id,
      item_order: item.item_order,
      completed: false,
      completed_at: '',
      sets_done: '',
      reps_done: '',
      duration_sec: '',
      rpe: '',
      notes: ''
    })));
  logEvent_({
    event_name: 'session_created',
    user_id: user.user_id,
    record_type: 'session',
    record_id: sessionId,
    severity: 'info',
    message: 'Workout session created',
    payload: {
      template_id: templateId,
      session_date: date
    }
  });
  const created = findOne_(
    APP.SHEETS.SESSIONS,
    row => row.session_id === sessionId
  );
  return buildSessionResponse_(created);
}
function apiStartSession_(body) {
  const sessionId = required_(body.session_id, 'session_id');
  const session = findOne_(
    APP.SHEETS.SESSIONS,
    row => row.session_id === sessionId
  );
  if (!session) {
    throw new Error('Session not found: ' + sessionId);
  }
  updateRowByKey_(
    APP.SHEETS.SESSIONS,
    'session_id',
    sessionId,
    {
      started_at: session.started_at || timestamp_(),
      status: 'in_progress'
    }
  );
  logEvent_({
    event_name: 'session_started',
    user_id: session.user_id,
    record_type: 'session',
    record_id: sessionId,
    severity: 'info',
    message: 'Workout session started'
  });
  return buildSessionResponse_(
    findOne_(
      APP.SHEETS.SESSIONS,
      row => row.session_id === sessionId
    )
  );
}
function apiCheckItem_(body) {
  const sessionItemId = required_(
    body.session_item_id,
    'session_item_id'
  );
  const item = findOne_(
    APP.SHEETS.SESSION_ITEMS,
    row => row.session_item_id === sessionItemId
  );
  if (!item) {
    throw new Error('Session item not found: ' + sessionItemId);
  }
  const completed = body.completed === undefined
    ? true
    : isTrue_(body.completed);
  const changes = {
    completed: completed,
    completed_at: completed ? timestamp_() : ''
  };
  if (body.sets_done !== undefined) {
    changes.sets_done = body.sets_done;
  }
  if (body.reps_done !== undefined) {
    changes.reps_done = body.reps_done;
  }
  if (body.duration_sec !== undefined) {
    changes.duration_sec = body.duration_sec;
  }
  if (body.rpe !== undefined) {
    changes.rpe = body.rpe;
  }
  if (body.notes !== undefined) {
    changes.notes = body.notes;
  }
  updateRowByKey_(
    APP.SHEETS.SESSION_ITEMS,
    'session_item_id',
    sessionItemId,
    changes
  );
  const session = findOne_(
    APP.SHEETS.SESSIONS,
    row => row.session_id === item.session_id
  );
  if (session && session.status === 'scheduled') {
    updateRowByKey_(
      APP.SHEETS.SESSIONS,
      'session_id',
      item.session_id,
      {
        started_at: timestamp_(),
        status: 'in_progress'
      }
    );
  }
  logEvent_({
    event_name: completed ? 'item_checked' : 'item_unchecked',
    user_id: session ? session.user_id : '',
    record_type: 'session_item',
    record_id: sessionItemId,
    severity: 'info',
    message: completed
      ? 'Workout item completed'
      : 'Workout item reopened',
    payload: {
      session_id: item.session_id,
      exercise_id: item.exercise_id
    }
  });
  return buildSessionResponse_(
    findOne_(
      APP.SHEETS.SESSIONS,
      row => row.session_id === item.session_id
    )
  );
}
function apiCompleteSession_(body) {
  const sessionId = required_(body.session_id, 'session_id');
  const session = findOne_(
    APP.SHEETS.SESSIONS,
    row => row.session_id === sessionId
  );
  if (!session) {
    throw new Error('Session not found: ' + sessionId);
  }
  updateRowByKey_(
    APP.SHEETS.SESSIONS,
    'session_id',
    sessionId,
    {
      started_at: session.started_at || timestamp_(),
      completed_at: timestamp_(),
      status: 'completed',
      overall_notes:
        body.overall_notes !== undefined
          ? body.overall_notes
          : session.overall_notes
    }
  );
  if (session.schedule_id) {
    updateRowByKey_(
      APP.SHEETS.SCHEDULE,
      'schedule_id',
      session.schedule_id,
      {
        status: 'completed'
      }
    );
  }
  logEvent_({
    event_name: 'session_completed',
    user_id: session.user_id,
    record_type: 'session',
    record_id: sessionId,
    severity: 'info',
    message: 'Workout session completed'
  });
  return buildSessionResponse_(
    findOne_(
      APP.SHEETS.SESSIONS,
      row => row.session_id === sessionId
    )
  );
}
function apiSkipSession_(body) {
  const sessionId = required_(body.session_id, 'session_id');
  const session = findOne_(
    APP.SHEETS.SESSIONS,
    row => row.session_id === sessionId
  );
  if (!session) {
    throw new Error('Session not found: ' + sessionId);
  }
  updateRowByKey_(
    APP.SHEETS.SESSIONS,
    'session_id',
    sessionId,
    {
      status: 'skipped',
      overall_notes:
        body.overall_notes !== undefined
          ? body.overall_notes
          : session.overall_notes
    }
  );
  if (session.schedule_id) {
    updateRowByKey_(
      APP.SHEETS.SCHEDULE,
      'schedule_id',
      session.schedule_id,
      {
        status: 'skipped'
      }
    );
  }
  logEvent_({
    event_name: 'session_skipped',
    user_id: session.user_id,
    record_type: 'session',
    record_id: sessionId,
    severity: 'info',
    message: 'Workout session skipped'
  });
  return buildSessionResponse_(
    findOne_(
      APP.SHEETS.SESSIONS,
      row => row.session_id === sessionId
    )
  );
}
function apiSaveMetric_(body) {
  const user = resolveUser_(body.user || body.user_id);
  if (!user) {
    throw new Error('User not found');
  }
  const metricType = required_(
    body.metric_type,
    'metric_type'
  );
  if (body.value === undefined || body.value === null) {
    throw new Error('value is required');
  }
  const metricId = makeId_('MET');
  appendObject_(APP.SHEETS.METRICS, {
    metric_id: metricId,
    user_id: user.user_id,
    metric_date: normalizeDate_(
      body.metric_date || today_()
    ),
    metric_type: metricType,
    value: body.value,
    unit: body.unit || '',
    source: body.source || APP.SOURCE,
    session_id: body.session_id || '',
    notes: body.notes || ''
  });
  logEvent_({
    event_name: 'metric_saved',
    user_id: user.user_id,
    record_type: 'metric',
    record_id: metricId,
    severity: 'info',
    message: 'Metric saved',
    payload: {
      metric_type: metricType
    }
  });
  return {
    metric_id: metricId
  };
}
/* ============================================================
 * RESPONSE BUILDERS
 * ============================================================ */
function buildSessionSummary_(session) {
  const items = findRows_(APP.SHEETS.SESSION_ITEMS,
    item => item.session_id === session.session_id);
  return {...session, items, progress: buildProgress_(items)};
}

function buildSessionResponse_(session) {
  if (!session) return null;
  const items = findRows_(
    APP.SHEETS.SESSION_ITEMS,
    row => row.session_id === session.session_id
  );
  items.sort((a, b) =>
    Number(a.item_order || 0) - Number(b.item_order || 0)
  );
  const enrichedItems = items.map(item => {
    const exercise = item.exercise_id
      ? findOne_(
          APP.SHEETS.EXERCISES,
          row => row.exercise_id === item.exercise_id
        )
      : null;
    const steps = item.exercise_id
      ? findRows_(
          APP.SHEETS.EXERCISE_STEPS,
          row =>
            row.exercise_id === item.exercise_id &&
            isTrue_(row.active)
        )
      : [];
    steps.sort((a, b) =>
      Number(a.step_order || 0) - Number(b.step_order || 0)
    );
    const templateItem = item.template_item_id
      ? findOne_(
          APP.SHEETS.WORKOUT_TEMPLATE_ITEMS,
          row =>
            row.template_item_id === item.template_item_id
        )
      : null;
    return {
      ...item,
      title:
        (templateItem && templateItem.display_title) ||
        (exercise && exercise.title) ||
        '',
      thumbnail_url:
        exercise ? exercise.thumbnail_url || '' : '',
      exercise: exercise,
      steps: steps,
      prescription: templateItem
    };
  });
  return {
    ...session,
    items: enrichedItems,
    progress: buildProgress_(enrichedItems)
  };
}
function buildTemplateResponse_(templateId) {
  const template = findOne_(
    APP.SHEETS.WORKOUT_TEMPLATES,
    row => row.template_id === templateId
  );
  if (!template) {
    throw new Error('Template not found: ' + templateId);
  }
  const items = findRows_(
    APP.SHEETS.WORKOUT_TEMPLATE_ITEMS,
    row => row.template_id === templateId
  );
  items.sort((a, b) =>
    Number(a.item_order || 0) - Number(b.item_order || 0)
  );
  return {
    template_id: templateId,
    template: template,
    items: items.map(item => {
      const exercise = findOne_(
        APP.SHEETS.EXERCISES,
        row => row.exercise_id === item.exercise_id
      );
      return {
        ...item,
        exercise: exercise
      };
    })
  };
}
function buildProgress_(items) {
  const total = items.length;
  const complete = items.filter(item =>
    isTrue_(item.completed)
  ).length;
  return {
    total: total,
    completed: complete,
    remaining: total - complete,
    percent:
      total > 0
        ? Math.round((complete / total) * 100)
        : 0
  };
}
/* ============================================================
 * USER RESOLUTION
 * ============================================================ */
function resolveUser_(value) {
  const users = getRows_(APP.SHEETS.USERS)
    .filter(row => isTrue_(row.active));
  let key = String(value || '').trim();
  if (!key) {
    key =
      getConfig_('default_user_id') ||
      getConfig_('default_user_slug') ||
      '';
  }
  return users.find(row =>
    row.user_id === key ||
    row.slug === key ||
    row.display_name === key
  ) || null;
}
/* ============================================================
 * SHEET DATABASE HELPERS
 * ============================================================ */
function getSheet_(sheetName) {
  const db = requestDbContext_();
  if (!db.sheets[sheetName]) {
    db.sheets[sheetName] = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!db.sheets[sheetName]) throw new Error('Missing sheet: ' + sheetName);
  }
  return db.sheets[sheetName];
}

function getRows_(sheetName) {
  const db = requestDbContext_();
  if (Object.prototype.hasOwnProperty.call(db.rows, sheetName)) return db.rows[sheetName];
  const sh = getSheet_(sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return db.rows[sheetName] = [];
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  db.reads[sheetName] = (db.reads[sheetName] || 0) + 1;
  const headers = values[0].map(h => String(h).trim());
  db.headers[sheetName] = headers;
  // Keep physical row numbers BEFORE dropping blank rows. The seeded sheet
  // contains a blank row 2, so filtering first gives the wrong update target.
  const rows = [];
  values.slice(1).forEach((row, index) => {
    if (!row.some(cell => cell !== '' && cell !== null)) return;
    const obj = {_row: index + 2};
    headers.forEach((header, col) => {
      if (header) obj[header] = serializeCell_(row[col]);
    });
    rows.push(obj);
  });
  db.rows[sheetName] = rows;
  return rows;
}

function getHeaders_(sheetName) {
  const db = requestDbContext_();
  if (!db.headers[sheetName]) {
    const sh = getSheet_(sheetName);
    if (sh.getLastColumn() > 0) {
      db.headers[sheetName] = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
    }
  }
  if (!db.headers[sheetName]) throw new Error('Missing headers in ' + sheetName);
  return db.headers[sheetName];
}

function findRows_(sheetName, predicate) { return getRows_(sheetName).filter(predicate); }
function findOne_(sheetName, predicate) { return getRows_(sheetName).find(predicate) || null; }

function appendObjects_(sheetName, objects) {
  if (!objects.length) return;
  const sh = getSheet_(sheetName);
  const headers = getHeaders_(sheetName);
  const values = objects.map(obj => headers.map(header => obj[header] !== undefined ? obj[header] : ''));
  sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  invalidateRows_(sheetName);
}
function appendObject_(sheetName, obj) {
  // Native appendRow avoids collisions between simultaneous GET event logs.
  const sh = getSheet_(sheetName);
  const headers = getHeaders_(sheetName);
  sh.appendRow(headers.map(header => obj[header] !== undefined ? obj[header] : ''));
  invalidateRows_(sheetName);
}

function updateRowByKey_(sheetName, keyColumn, keyValue, changes) {
  const sh = getSheet_(sheetName);
  const headers = getHeaders_(sheetName);
  if (!headers.includes(keyColumn)) throw new Error('Key column not found: ' + sheetName + '.' + keyColumn);
  const record = findOne_(sheetName, row => String(row[keyColumn]) === String(keyValue));
  if (!record) throw new Error('Record not found in ' + sheetName + ': ' + keyValue);
  const fields = Object.keys(changes).map(field => {
    const col = headers.indexOf(field);
    if (col < 0) throw new Error('Column not found: ' + sheetName + '.' + field);
    return {col, value: changes[field]};
  }).sort((a, b) => a.col - b.col);
  // Batch adjacent changed cells, preserving every untouched value/formula.
  for (let i = 0; i < fields.length;) {
    const first = fields[i];
    const values = [first.value];
    let j = i + 1;
    while (j < fields.length && fields[j].col === fields[j - 1].col + 1) values.push(fields[j++].value);
    sh.getRange(record._row, first.col + 1, 1, values.length).setValues([values]);
    i = j;
  }
  invalidateRows_(sheetName);
  return record._row;
}

/* ============================================================
 * CONFIG
 * ============================================================ */
function getConfig_(key) {
  const row = findOne_(
    APP.SHEETS.CONFIG,
    item => item.key === key
  );
  return row ? row.value : '';
}
/* ============================================================
 * LOGGING
 *
 * Important:
 * Logs is ONLY an event trail.
 *
 * Actual state belongs in:
 * Sessions, SessionItems, Metrics, etc.
 * ============================================================ */
function logEvent_(opts) {
  try {
    if (
      String(getConfig_('logging_enabled')).toUpperCase() !==
      'TRUE'
    ) {
      return;
    }
    appendObject_(APP.SHEETS.LOGS, {
      event_id: makeId_('EVT'),
      timestamp: timestamp_(),
      event_name: opts.event_name || '',
      user_id: opts.user_id || '',
      record_type: opts.record_type || '',
      record_id: opts.record_id || '',
      source: opts.source || APP.SOURCE,
      severity: opts.severity || 'info',
      message: opts.message || '',
      payload_json: opts.payload
        ? JSON.stringify(opts.payload)
        : ''
    });
  } catch (loggingError) {
    console.error(
      'Logging failed:',
      loggingError.message
    );
  }
}
function logError_(eventName, err, payload) {
  logEvent_({
    event_name: eventName,
    record_type: 'error',
    severity: 'error',
    message: err.message,
    payload: {
      stack: err.stack || '',
      context: payload || {}
    }
  });
}
/* ============================================================
 * UTILITY
 * ============================================================ */
function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(
      JSON.stringify(obj)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );
}
function parseJsonBody_(e) {
  if (
    !e ||
    !e.postData ||
    !e.postData.contents
  ) {
    throw new Error('POST requires JSON body');
  }
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    throw new Error('Invalid JSON body');
  }
}
function safeParseBody_(e) {
  try {
    return parseJsonBody_(e);
  } catch (_) {
    return {};
  }
}
function required_(value, fieldName) {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ''
  ) {
    throw new Error(
      fieldName + ' is required'
    );
  }
  return String(value).trim();
}
function isTrue_(value) {
  if (value === true) return true;
  const str = String(value || '')
    .toLowerCase()
    .trim();
  return (
    str === 'true' ||
    str === '1' ||
    str === 'yes'
  );
}
function makeId_(prefix) {
  const id = Utilities
    .getUuid()
    .replace(/-/g, '')
    .substring(0, 12)
    .toUpperCase();
  return prefix + '-' + id;
}
function timestamp_() {
  return Utilities.formatDate(
    new Date(),
    getTimezone_(),
    "yyyy-MM-dd'T'HH:mm:ssXXX"
  );
}
function today_() {
  return Utilities.formatDate(
    new Date(),
    getTimezone_(),
    'yyyy-MM-dd'
  );
}
function getTimezone_() {
  return (
    getConfig_('timezone') ||
    Session.getScriptTimeZone() ||
    'America/Los_Angeles'
  );
}
function normalizeDate_(value) {
  if (!value) return '';
  if (
    Object.prototype.toString.call(value) ===
    '[object Date]'
  ) {
    return Utilities.formatDate(
      value,
      getTimezone_(),
      'yyyy-MM-dd'
    );
  }
  const str = String(value).trim();
  const match = str.match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );
  if (match) {
    return match[1] + '-' + match[2] + '-' + match[3];
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(
      parsed,
      getTimezone_(),
      'yyyy-MM-dd'
    );
  }
  return str;
}
function serializeCell_(value) {
  if (
    Object.prototype.toString.call(value) ===
    '[object Date]'
  ) {
    return Utilities.formatDate(
      value,
      getTimezone_(),
      "yyyy-MM-dd'T'HH:mm:ssXXX"
    );
  }
  return value;
}
/* ============================================================
 * OPTIONAL TEST FUNCTIONS
 *
 * These appear in the Run dropdown in Apps Script.
 * ============================================================ */
function testHealth() {
  resetRequestDb_();
  console.log(
    JSON.stringify(
      apiHealth_(),
      null,
      2
    )
  );
}
function testAndrew() {
  resetRequestDb_();
  console.log(
    JSON.stringify(
      apiDashboard_({
        user: 'andrew.hunter',
        date: today_()
      }),
      null,
      2
    )
  );
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {dateKey, parseDate, shiftDate, storageKey, readCompletion} from '../workout-state.js';
test('date arithmetic follows local calendar days across month, year and daylight saving boundaries', () => {
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2026-03-08', -1), '2026-03-07');
  assert.equal(shiftDate('2026-11-01', 1), '2026-11-02');
  assert.equal(shiftDate('2028-02-28', 1), '2028-02-29');
  assert.equal(parseDate('2026-02-29'), null);
  assert.equal(parseDate('wrong'), null);
  assert.equal(dateKey(new Date(2026, 9, 3, 23, 59)), '2026-10-03');
});
test('completion is isolated by user, workout, date and session', () => {
  const key = storageKey('andrew.hunter', 'rehab', '2026-10-03', 1);
  const values = new Map([[key, '["ankle-alphabet"]']]);
  const storage = {getItem: k => values.get(k)};
  const ids = ['ankle-alphabet', 'calf'];
  assert.equal(readCompletion(storage, key, ids).size, 1);
  for (const other of [storageKey('andrew.hunter','rehab','2026-10-03',2), storageKey('andrew.hunter','rehab','2026-10-04',1), storageKey('other','rehab','2026-10-03',1), storageKey('andrew.hunter','other','2026-10-03',1)]) {
    assert.equal(readCompletion(storage, other, ids).size, 0);
  }
});
test('corrupted progress and stale activity IDs cannot inflate completion', () => {
  const storage = value => ({getItem: () => value});
  assert.deepEqual([...readCompletion(storage('["valid","valid","removed"]'), 'key', ['valid'])], ['valid']);
  for (const value of ['{', '{}', 'null', '1']) assert.equal(readCompletion(storage(value), 'key', ['valid']).size, 0);
});

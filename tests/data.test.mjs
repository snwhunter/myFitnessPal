import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
const data = JSON.parse(readFileSync(new URL('../data/andrew-ankle-rehab.json', import.meta.url)));
test('Andrew has seven source-backed activities with real detail images', () => {
 assert.equal(data.workout.times_per_day, 2);
 assert.equal(data.activities.length, 7);
 assert.equal(new Set(data.activities.map(a => a.activity_id)).size, 7);
 for(const activity of data.activities) {
   assert.ok(activity.steps.length > 0);
   assert.ok(activity.prescription);
   assert.ok(existsSync(new URL('../'+activity.thumbnail, import.meta.url)));
   for(const image of activity.images) assert.ok(existsSync(new URL('../'+image.src, import.meta.url)));
 }
});
test('reps, sets and holds match the supplied exercise sheets', () => {
 const doses = data.activities.map(a => [a.sets, a.reps, a.hold_seconds]);
 assert.deepEqual(doses, [[null,null,null],[3,10,null],[3,10,5],[3,10,null],[3,10,5],[3,10,15],[null,3,30]]);
});

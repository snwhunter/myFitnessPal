import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../backend/Code.gs',import.meta.url),'utf8');
function harness(sessionCount=7) {
 const tables={
  Users:[['user_id','slug','display_name','active'],[],['USR-0001','andrew.hunter','Andrew',true]],
  Config:[['key','value'],['timezone','America/Los_Angeles'],['logging_enabled',true]],
  Schedule:[['schedule_id','user_id','scheduled_date']],
  Metrics:[['metric_id','user_id','metric_date']],
  Sessions:[['session_id','user_id','template_id','schedule_id','session_date','started_at','completed_at','status','overall_notes'],[]],
  SessionItems:[['session_item_id','session_id','template_item_id','exercise_id','item_order','completed','completed_at','sets_done','reps_done','duration_sec','rpe','notes'],[]],
  Exercises:[['exercise_id','title','thumbnail_url','active']],
  ExerciseSteps:[['exercise_id','step_order','instruction','active']],
  WorkoutTemplates:[['template_id','title','times_per_day','active'],['andrew-ankle-rehab','Rehab',2,true]],
  WorkoutTemplateItems:[['template_item_id','template_id','exercise_id','item_order','display_title','notes']],
  Logs:[['event_id','timestamp','event_name','user_id','record_type','record_id','source','severity','message','payload_json']]
 };
 for(let i=1;i<=7;i++) {
  tables.Exercises.push([`E${i}`,`Exercise ${i}`,'image.jpg',true]);
  tables.ExerciseSteps.push([`E${i}`,1,'Step',true]);
  tables.WorkoutTemplateItems.push([`T${i}`,'andrew-ankle-rehab',`E${i}`,i,'','3 sets']);
 }
 for(let i=1;i<=sessionCount;i++) {
  tables.Sessions.push([`S${i}`,'USR-0001','andrew-ankle-rehab','','2026-10-06','','','scheduled','']);
  for(let j=1;j<=7;j++)tables.SessionItems.push([`S${i}I${j}`,`S${i}`,`T${j}`,`E${j}`,j,false,'','','','','','']);
 }
 const reads={};const writes=[];let held=false;let releases=0;let uuid=0;
 const sheets={};
 for(const [name,rows] of Object.entries(tables)) {
  sheets[name]={
   getLastRow:()=>rows.length,getLastColumn:()=>rows[0].length,
   getRange:(r,c,n=1,m=1)=>({
    getValues:()=>{reads[name]=(reads[name]||0)+1;return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r+i-1]?.[c+j-1]??''))},
    setValues:values=>{writes.push({name,r,c,n,m});values.forEach((row,i)=>row.forEach((value,j)=>{rows[r+i-1]||=[];rows[r+i-1][c+j-1]=value}))}
   }),
   appendRow:values=>{writes.push({name,append:true});rows.push(values.slice())}
  };
 }
 const ctx=vm.createContext({console,SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:name=>sheets[name],getId:()=> 'id',getName:()=> 'Backend'}),flush(){}},LockService:{getScriptLock:()=>({tryLock(){if(held)throw Error('Lock acquired twice');held=true;return true},hasLock:()=>held,releaseLock(){held=false;releases++}})},Utilities:{getUuid:()=>String(++uuid).padEnd(32,'0'),formatDate:(d,t,f)=>f==='yyyy-MM-dd'?'2026-10-06':'2026-10-06T17:00:00-07:00'},Session:{getScriptTimeZone:()=> 'America/Los_Angeles'},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this}})}});
 vm.runInContext(code,ctx);
 function get(action,params={}) {return JSON.parse(ctx.doGet({parameter:{action,user:'andrew.hunter',date:'2026-10-06',...params}}).text)}
 function post(action,body={}) {return JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action,user_id:'USR-0001',...body})}}).text)}
 return {ctx,tables,reads,writes,get,post,get releases(){return releases},get held(){return held}};
}
test('seven detailed sessions read related tables once per request and preserve payloads',()=>{
 const h=harness();const result=h.get('dashboard');assert.equal(result.ok,true);
 assert.equal(result.data.sessions.length,7);assert.equal(result.data.sessions[0].items.length,7);
 assert.equal(result.data.sessions[0].items[0].title,'Exercise 1');
 assert.equal(result.data.sessions[0].items[0].steps[0].instruction,'Step');
 for(const name of ['Users','Schedule','Sessions','SessionItems','Exercises','ExerciseSteps','WorkoutTemplateItems','Metrics'])assert.equal(h.reads[name],1,name);
 const firstReads=h.reads.Exercises;h.get('dashboard');assert.equal(h.reads.Exercises,firstReads+1,'new request must refresh data');
});
test('summary history avoids reading exercise tables',()=>{
 const h=harness();const result=h.get('sessions',{summary:'true'});
 assert.equal(result.data.sessions.length,7);assert.equal(result.data.sessions[0].progress.total,7);
 assert.equal(h.reads.Exercises,undefined);assert.equal(h.reads.ExerciseSteps,undefined);
});
test('blank rows retain physical update targets and post responses reflect saved values',()=>{
 const h=harness(1);const result=h.post('checkItem',{session_item_id:'S1I1',completed:true});
 assert.equal(result.ok,true);assert.equal(result.data.items[0].completed,true);
 assert.equal(result.data.status,'in_progress');assert.equal(h.tables.SessionItems[1].length,0);
 assert.equal(h.tables.SessionItems[2][5],true);assert.equal(h.releases,1);assert.equal(h.held,false);
});
test('session slot retries reuse IDs, create seven items in one write, and respect the daily limit',()=>{
 const h=harness(0);const body={template_id:'andrew-ankle-rehab',session_date:'2026-10-06',session_number:1};
 const a=h.post('createSession',body);assert.equal(a.ok,true);assert.equal(a.data.items.length,7);
 const b=h.post('createSession',body);assert.equal(b.data.session_id,a.data.session_id);
 assert.equal(h.tables.Sessions.length,3);
 assert.equal(h.writes.filter(w=>w.name==='SessionItems').length,1);
 assert.equal(h.writes.find(w=>w.name==='SessionItems').n,7);
 const c=h.post('createSession',{...body,session_number:2});assert.equal(c.ok,true);assert.notEqual(c.data.session_id,a.data.session_id);
 const legacy=h.post('createSession',{template_id:body.template_id,session_date:body.session_date});
 assert.equal(legacy.data.session_id,c.data.session_id);assert.equal(h.tables.Sessions.length,4);
 const invalid=h.post('createSession',{...body,session_number:3});assert.equal(invalid.ok,false);assert.equal(h.held,false);
});
test('existing extra sessions remain intact and start/completion state survives cache invalidation',()=>{
 const h=harness(7);
 const result=h.post('createSession',{template_id:'andrew-ankle-rehab',session_date:'2026-10-06',session_number:2});
 assert.equal(result.data.session_id,'S2');assert.equal(h.tables.Sessions.length,9);
 assert.equal(h.post('startSession',{session_id:'S1'}).data.status,'in_progress');
 assert.equal(h.post('completeSession',{session_id:'S1'}).data.status,'completed');
 assert.equal(h.get('dashboard').data.sessions[0].status,'completed');
});

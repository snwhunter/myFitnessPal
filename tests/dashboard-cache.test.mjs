import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace(/load\(\);\s*$/,'');
const key='myfitnesspal:dashboard:v1:andrew.hunter';
const session={session_id:'s1',session_date:'2026-10-06',template_id:'andrew-ankle-rehab',status:'in_progress',items:[{session_item_id:'i1',title:'Alphabet',completed:false}]};
const dashboard={user:{user_id:'u1',display_name:'Andrew'},sessions:[session]};
function harness(initial,storageDisabled=false) {
 const values=new Map(initial===undefined?[]:[[key,typeof initial==='string'?initial:JSON.stringify(initial)]]);
 const nodes=new Map();const el=id=>{if(!nodes.has(id))nodes.set(id,{hidden:['dashboard','workout'].includes(id),textContent:'',innerHTML:'',value:'',style:{},parentElement:{setAttribute(){}},querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}});return nodes.get(id)};
 const requests=[];
 const ctx=vm.createContext({URL,URLSearchParams,performance,console:{debug(){},table(){}},location:{search:'?user=andrew.hunter',href:'https://example.com/?user=andrew.hunter'},localStorage:{getItem(k){if(storageDisabled)throw Error('disabled');return values.get(k)},setItem(k,v){if(storageDisabled)throw Error('disabled');values.set(k,v)}},sessionStorage:{getItem(){return null},setItem(){}},document:{getElementById:el,querySelector:()=>el('pill')},history:{replaceState(){}},window:{scrollTo(){}},requestAnimationFrame(){},dateKey:()=> '2026-10-06',parseDate:d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')?new Date(d+'T12:00:00'):null,shiftDate:(d,n)=>{const t=new Date(d+'T12:00:00');t.setDate(t.getDate()+n);return t.toISOString().slice(0,10)},fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url:String(url),options,resolve:data=>resolve({ok:true,status:200,json:async()=>({ok:true,backend_version:'0.3.3',data})}),reject}))});
 vm.runInContext(source,ctx);
 const run=s=>vm.runInContext(s,ctx);
 const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
 return {ctx,el,requests,values,run,tick};
}
function cache(data=dashboard){return {schema:1,user:'andrew.hunter',dates:{'2026-10-06':{savedAt:Date.now(),data}}}}
test('saved dashboard renders before live response, updates on refresh, and uses embedded user',async()=>{
 const h=harness(cache());const loading=h.run('load()');await h.tick();
 assert.equal(h.el('dashboard').hidden,false);assert(h.el('sessions').innerHTML.includes('Session 1'));
 assert(h.el('dashboardNotice').textContent.includes('Updating'));assert.equal(h.requests.length,1);
 h.requests[0].resolve({...dashboard,sessions:[{...session,status:'completed'}]});await loading;
 assert(h.el('sessions').innerHTML.includes('Complete'));assert.equal(h.el('dashboardNotice').textContent,'Up to date');
 assert.equal(h.requests.filter(r=>r.url.includes('action=user')).length,0);
 assert.equal(JSON.parse(h.values.get(key)).dates['2026-10-06'].data.sessions[0].status,'completed');
});
test('offline refresh retains clearly labelled saved data',async()=>{
 const h=harness(cache());const loading=h.run('load()');await h.tick();h.requests[0].reject(Error('offline'));await loading;
 assert.equal(h.el('dashboard').hidden,false);assert(h.el('dashboardNotice').textContent.includes('Refresh failed'));
});
test('corrupt, cross-user, expired and disabled storage fall back to live loading',async()=>{
 for(const initial of ['broken',{...cache(),user:'someone.else'},cache({...dashboard,sessions:[null]}),{...cache(),dates:{'2026-10-06':{savedAt:0,data:dashboard}}}]) {
  const h=harness(initial);const loading=h.run('load()');await h.tick();assert.equal(h.el('dashboard').hidden,true);
  h.requests[0].resolve(dashboard);await loading;assert.equal(h.el('dashboard').hidden,false);
 }
 const h=harness(undefined,true);const loading=h.run('load()');await h.tick();h.requests[0].resolve(dashboard);await loading;assert.equal(h.el('dashboard').hidden,false);
});
test('late background reads cannot replace newer saved session changes',async()=>{
 const h=harness(cache());const loading=h.run('load()');await h.tick();
 h.run("rememberSession({...dashboardData.sessions[0],status:'completed'})");
 h.requests[0].resolve(dashboard);await loading;
 assert.equal(h.run('dashboardData.sessions[0].status'),'completed');
 assert.equal(JSON.parse(h.values.get(key)).dates['2026-10-06'].data.sessions[0].status,'completed');
});
test('date changes deduplicate reads and ignore out-of-order responses',async()=>{
 const h=harness();h.run("selectedDate='2026-10-06'; userData={user_id:'u1',display_name:'Andrew'}; dashboardData={sessions:[]}");
 const first=h.run("chooseDate('2026-10-05')");await h.tick();
 const second=h.run("chooseDate('2026-10-04')");await h.tick();
 h.requests[1].resolve({...dashboard,sessions:[]});await second;
 h.requests[0].resolve(dashboard);await first;
 assert.equal(h.run('selectedDate'),'2026-10-04');assert.equal(h.run('dashboardData.sessions.length'),0);
 const a=h.run("loadDashboard('2026-10-04')");const b=h.run("loadDashboard('2026-10-04')");
 assert.equal(h.requests.filter(r=>r.url.includes('date=2026-10-04')).length,2); // one completed + one shared pending
 h.requests.at(-1).resolve({...dashboard,sessions:[]});await Promise.all([a,b]);
});

const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const brushing=require('../data/andrew-teeth-brushing.json');
const seed=require('../data/andrew-ankle-rehab.json');
const output=process.env.BROWSER_ARTIFACTS || '/tmp/myfitnesspal-browser';
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/Los_Angeles'});
 const sessions=[]; const calls=[]; let releaseHistory;
 const historyGate=new Promise(resolve=>releaseHistory=resolve);
 let releaseStart; let nextId=0; let dashboardGate;
 await context.route('https://script.google.com/**',async route=>{
   const request=route.request(); const url=new URL(request.url());
   const body=request.method()==='POST'?JSON.parse(request.postData()):Object.fromEntries(url.searchParams);
   const action=body.action; calls.push(action); let data;
   if(action==='user') {
     if(body.user!=='andrew.hunter') return route.fulfill({json:{ok:false,error:'Unknown user'}});
     data={user_id:'andrew.hunter',display_name:'Andrew'};
   } else if(action==='dashboard') {if(body.user!=='andrew.hunter') return route.fulfill({json:{ok:false,error:'Unknown user'}}); if(dashboardGate) await dashboardGate; data={user:{user_id:'andrew.hunter',display_name:'Andrew'},sessions:sessions.filter(s=>s.session_date===body.date)};}
   else if(action==='sessions') {await historyGate;data={sessions};}
   else if(action==='createSession') {
     const id=`session-${++nextId}`;
     data={session_id:id,session_date:body.session_date,template_id:body.template_id,status:'scheduled',items:seed.activities.map(a=>({session_item_id:`${id}-${a.activity_id}`,title:a.title,completed:false,prescription:{notes:a.prescription},exercise:{summary:a.purpose,notes:a.notes},thumbnail_url:a.thumbnail,steps:a.steps.map((instruction,i)=>({instruction,image_url:a.images[i]?.src}))}))};
     if(body.template_id.startsWith('andrew-teeth-')) data.items=[{
       session_item_id:`${id}-teeth`,title:'Brush teeth',completed:false,
       prescription:{notes:'2 minutes',duration_sec:120},
       exercise:{category:'oral hygiene',summary:'Brush morning and evening.'},
       thumbnail_url:'assets/exercises/teeth-brushing.svg',
       steps:brushing.rows.ExerciseSteps.map(row=>({instruction:row[4],image_url:row[5]}))
     }];
     sessions.push(data);
   } else if(action==='startSession') {
     await new Promise(resolve=>releaseStart=resolve);
     data=sessions.find(s=>s.session_id===body.session_id);data.status='in_progress';
   } else if(action==='checkItem') {
     data=sessions.find(s=>s.items.some(i=>i.session_item_id===body.session_item_id));
     data.items.find(i=>i.session_item_id===body.session_item_id).completed=body.completed;
     data.progress={percent:Math.round(100*data.items.filter(i=>i.completed).length/data.items.length)};
   } else if(action==='completeSession') {data=sessions.find(s=>s.session_id===body.session_id);data.status='completed';}
   else throw Error(`Unexpected action ${action}`);
   await route.fulfill({json:{ok:true,backend_version:"0.3.3",data}});
 });
 const page=await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8765/?user=andrew.hunter');
 await page.locator('.session-card').first().waitFor();
 assert.equal(await page.locator('.session-card').count(),4,'Cards render while history request is pending');
 assert.equal(await page.locator('#appVersion').innerText(),'v0.3.5');
 assert.equal(await page.locator('#backendVersion').innerText(),'Backend: 0.3.3');
 await page.locator('#callLogPanel summary').click();
 assert.ok((await page.locator('#callLogRows').innerText()).includes('pending'));
 await page.locator('#callLogPanel summary').click();
 const today=await page.locator('#datePicker').inputValue();
 await page.screenshot({path:output+'/dashboard-mobile.png'});
 await page.locator('[data-session="2"]').click();
 await page.locator('.item').first().waitFor();
 assert.equal(await page.locator('.item').count(),7,'Details render before startSession finishes');
 await page.waitForFunction(()=>document.querySelector('.check').disabled);
 assert.equal(calls.filter(a=>a==='dashboard').length,1,'Creation responses avoid dashboard rereads');
 assert.equal(calls.filter(a=>a==='createSession').length,2);
 await page.locator('.exercise summary').nth(2).click();
 assert.ok((await page.locator('.detail').nth(2).innerText()).includes('hold 5 sec'));
 releaseStart();
 await page.waitForFunction(()=>!document.querySelector('.check').disabled);
 await page.locator('.check').first().check();
 await page.waitForFunction(()=>document.querySelector('#count').textContent==='1 / 7 complete');
 assert.equal(await page.locator('details[open]').count(),1);
 await page.screenshot({path:output+'/workout-mobile.png'});
 releaseHistory();
 await page.locator('#backButton').click();
 assert.equal(calls.filter(a=>a==='dashboard').length,1,'Back reuses current session data');
 await page.waitForFunction(()=>document.querySelector('#todayExercises').textContent==='1 / 16');
 await page.locator('[data-session="2"]').click();
 assert.equal(await page.locator('.check').first().isChecked(),true);
 await page.locator('#backButton').click();
 await page.locator('#previousDate').click();
 await page.waitForFunction(t=>document.querySelector('#datePicker').value!==t,today);
 await page.locator('[data-session="1"]').click();
 await page.locator('.item').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('.check').disabled);
 releaseStart();
 await page.waitForFunction(()=>!document.querySelector('.check').disabled);
 assert.equal(await page.locator('.check').first().isChecked(),false,'Completion is isolated by date');
 await page.locator('#backButton').click();
 await page.locator('#todayButton').click();
 await page.waitForFunction(t=>document.querySelector('#datePicker').value===t,today);
 await page.locator('[data-session="2"]').click();
 await page.locator('.item').first().waitFor();
 for(const box of await page.locator('.check').all()) {
   await box.check();
   await page.waitForFunction(()=>![...document.querySelectorAll('.check')].some(i=>i.disabled));
 }
 await page.locator('#backButton').click();
 await page.waitForFunction(()=>document.querySelector('#weekSessions').textContent==='1 / 28');
 assert.equal(await page.locator('.session-card.complete').count(),1);
 let releaseDashboard;
 dashboardGate=new Promise(resolve=>releaseDashboard=resolve);
 await page.reload();
 await page.locator('.session-card.complete').waitFor();
 assert.ok((await page.locator('#dashboardNotice').innerText()).includes('Updating'));
 await page.locator('[data-session="2"]').click();
 await page.locator('.item').first().waitFor();
 assert.equal(await page.locator('.check').first().isDisabled(),true,'Cached progress is checked before writes');
 releaseDashboard(); dashboardGate=null;
 await page.waitForFunction(()=>!document.querySelector('.check').disabled);
 await page.locator('#backButton').click();
 assert.equal(await page.locator('#appVersion').innerText(),'v0.3.5');
 const logs=await page.evaluate(()=>window.myFitnessPalLog.entries());
 assert(logs.some(e=>e.action==='checkItem'&&e.outcome==='success'&&e.durationMs>=0));
 assert(logs.every(e=>e.startedAt&&e.version==='0.3.5'));
 assert(logs.filter(e=>e.outcome!=='pending').every(e=>e.finishedAt));
 assert(logs.filter(e=>e.outcome==='success').every(e=>e.responseReceivedMs>=0));
 const beforeBrushing=sessions.length;
 await page.locator('[data-session="4"]').click();
 await page.locator('.item').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('.check').disabled);
 assert.equal(sessions.length,beforeBrushing+1,'Evening creates only its own session');
 assert.equal(sessions.at(-1).template_id,'andrew-teeth-evening');
 assert.equal(await page.locator('.item').count(),1);
 await page.locator('.exercise summary').click();
 assert.ok((await page.locator('.detail').innerText()).includes('45 degrees'));
 await page.locator('.detail-image').evaluate(img=>img.decode());
 releaseStart();
 await page.waitForFunction(()=>!document.querySelector('.check').disabled);
 await page.locator('.check').check();
 await page.waitForFunction(()=>document.querySelector('#count').textContent==='1 / 1 complete');
 await page.screenshot({path:output+'/brushing-mobile.png'});
 await page.locator('#backButton').click();
 assert.ok((await page.locator('[data-session="4"]').innerText()).includes('Complete'));
 assert.ok((await page.locator('[data-session="3"]').innerText()).includes('Start'));
 await page.locator('[data-session="3"]').click();
 await page.locator('.item').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('.check').disabled);
 releaseStart();
 await page.waitForFunction(()=>!document.querySelector('.check').disabled);
 assert.equal(await page.locator('.check').isChecked(),false,'Morning progress is independent of evening and rehab');
 await page.locator('#backButton').click();
 await page.reload();
 await page.locator('[data-session="4"]').waitFor();
 assert.ok((await page.locator('[data-session="4"]').innerText()).includes('Complete'),'Brushing persists on reload');
 await page.locator('#callLogPanel summary').click();
 assert.ok((await page.locator('#callLogRows').innerText()).includes('success'));
 await page.locator('#callLogPanel summary').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.setViewportSize({width:1280,height:900});
 await page.screenshot({path:output+'/dashboard-desktop.png'});
 await page.goto('http://localhost:8765/?user=unknown');
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Unknown user'));
 const failures=await page.evaluate(()=>window.myFitnessPalLog.entries());
 assert(failures.some(e=>e.action==='dashboard'&&e.outcome==='error'&&e.finishedAt));
 assert.deepEqual(errors,[]);
 console.log('PASS: delayed metrics/start, request counts, Google-backed persistence, completion/date isolation, local success/failure logs, visible version, mobile/desktop layout');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});


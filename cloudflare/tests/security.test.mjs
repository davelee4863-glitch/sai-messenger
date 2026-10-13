import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,login,room,request,socket,maintenance,sample} from './helpers.mjs';
test('unauthenticated HTTP/WS, nonmember access, CSRF and off-origin requests are rejected',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),d=await login(f,3),r=await room(f,[a,b]);
 assert.equal((await request(f,'/api/rooms')).status,401);assert.equal((await request(f,`/api/rooms/${r.id}`,{user:d})).status,403);
 for(const headers of [{Upgrade:'websocket',Origin:f.origin},{Upgrade:'websocket',Origin:f.origin,Cookie:d.cookie},{Upgrade:'websocket',Origin:'https://evil.invalid',Cookie:a.cookie}]){const res=await f.mf.dispatchFetch(f.origin+'/ws?roomId='+r.id,{headers});assert.ok([401,403].includes(res.status));}
 assert.equal((await request(f,`/api/rooms/${r.id}/messages`,{user:{...a,csrf:'wrong'},method:'POST',data:{clientMessageId:crypto.randomUUID(),text:'거부'}})).status,403);
 assert.equal((await request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',headers:{Origin:'https://evil.invalid'},data:{clientMessageId:crypto.randomUUID(),text:'거부'}})).status,403);
 assert.equal((await request(f,`/api/rooms/${r.id}/reset`,{user:b,method:'POST',data:{}})).status,403);assert.equal((await request(f,`/api/rooms/${r.id}/reset`,{user:a,method:'POST',data:{}})).status,409);
});
test('session cookie flags, logout/revocation and socket counts preserve authorization',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,[a,b]);assert.match(a.cookie,/^pb_cf_local_session=[a-f0-9]{64}$/);
 const sockets=await Promise.all([socket(f,b,r.id),socket(f,b,r.id),socket(f,b,r.id)]);const denied=await f.mf.dispatchFetch(f.origin+'/ws?roomId='+r.id,{headers:{Upgrade:'websocket',Origin:f.origin,Cookie:b.cookie}});assert.equal(denied.status,429);
 const closed=new Promise(resolve=>sockets[0].addEventListener('close',resolve));assert.equal((await request(f,'/api/admin/revoke',{user:b,method:'POST',data:{userId:a.id}})).status,403);assert.equal((await request(f,'/api/admin/revoke',{user:a,method:'POST',data:{userId:b.id}})).status,200);await closed;assert.equal((await request(f,'/api/session',{user:b})).status,401);
 assert.equal((await request(f,'/api/logout',{user:a,method:'POST',data:{}})).status,200);assert.equal((await request(f,'/api/session',{user:a})).status,401);
});
test('new group members cannot read, receipt or confirm old messages/proposals, even after delayed host confirmation',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),c=await login(f,2),r=await room(f,[a,b]);
 const group=(await request(f,'/api/rooms',{user:a,method:'POST',data:{kind:'group',title:'기록 비공개',memberIds:[b.id]}})).body.room;
 const old=await request(f,`/api/rooms/${group.id}/messages`,{user:a,method:'POST',data:{clientMessageId:crypto.randomUUID(),text:'가입 이전 가족 기록'}});const candidate=await request(f,`/api/rooms/${group.id}/proposals`,{user:a,method:'POST',data:sample});
 assert.equal((await request(f,`/api/rooms/${group.id}/members`,{user:b,method:'POST',data:{userId:c.id,active:true}})).status,403);
 assert.equal((await request(f,`/api/rooms/${group.id}/members`,{user:a,method:'POST',data:{userId:c.id,active:true}})).status,200);
 assert.equal((await request(f,`/api/rooms/${group.id}`,{user:c})).body.messages.length,0);assert.equal((await request(f,`/api/rooms/${group.id}`,{user:c})).body.proposals.length,0);
 assert.equal((await request(f,`/api/rooms/${group.id}/receipts`,{user:c,method:'POST',data:{messageIds:[old.body.message.id]}})).status,403);
 const confirmed=await request(f,`/api/proposals/${candidate.body.proposal.id}/confirm`,{user:a,method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}});assert.equal(confirmed.status,200);assert.equal((await request(f,`/api/promises/${confirmed.body.promise.id}`,{user:c})).status,403);
 const ws=await socket(f,c,group.id),closed=new Promise(resolve=>ws.addEventListener('close',resolve));await request(f,`/api/rooms/${group.id}/members`,{user:a,method:'POST',data:{userId:c.id,active:false}});await closed;assert.equal((await request(f,`/api/rooms/${group.id}`,{user:c})).status,403);
});
test('login throttles persist across isolate restart; arbitrary signup and maintenance paths are not public',async t=>{
 const f=await fixture(t);for(let i=0;i<5;i++)assert.equal((await request(f,'/api/login',{method:'POST',data:{handle:'nonexistent',password:'invalid-synthetic'}})).status,401);await f.restart();assert.equal((await request(f,'/api/login',{method:'POST',data:{handle:'nonexistent',password:'invalid-synthetic'}})).status,429);
 for(const path of ['/__provision','/__restore','/__backup','/%5f%5fbackup']){const r=await f.mf.dispatchFetch(f.origin+path);assert.ok([404,401].includes(r.status));}
 assert.equal((await request(f,'/api/register',{method:'POST',data:{}})).status,401);
});
test('server enforces five signup invite reservations, retries do not consume extra grants',async t=>{
 const f=await fixture(t),a=await login(f),id=crypto.randomUUID();assert.equal((await request(f,'/api/invites',{user:a,method:'POST',data:{requestId:id}})).status,201);assert.equal((await request(f,'/api/invites',{user:a,method:'POST',data:{requestId:id}})).status,201);
 const others=await Promise.all(Array.from({length:6},()=>request(f,'/api/invites',{user:a,method:'POST',data:{requestId:crypto.randomUUID()}})));assert.equal(others.filter(r=>r.status===201).length,4);assert.equal(others.filter(r=>r.status===409).length,2);await f.restart();assert.equal((await request(f,'/api/invites',{user:a,method:'POST',data:{requestId:crypto.randomUUID()}})).status,409);
});
test('oversized messages/bodies and spoofed fields are rejected; XSS is literal data with strict CSP',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,[a,b]),path=`/api/rooms/${r.id}/messages`;
 assert.equal((await request(f,path,{user:a,method:'POST',data:{clientMessageId:crypto.randomUUID(),text:'x'.repeat(2001)}})).status,422);
 assert.equal((await request(f,path,{user:a,method:'POST',data:{clientMessageId:crypto.randomUUID(),text:'x'.repeat(17000)}})).status,413);
 const canary='<img src=x onerror=alert(1)>';assert.equal((await request(f,path,{user:a,method:'POST',data:{clientMessageId:crypto.randomUUID(),text:canary}})).status,201);assert.equal((await request(f,`/api/rooms/${r.id}`,{user:b})).body.messages[0].body,canary);
 const html=await f.mf.dispatchFetch(f.origin+'/');assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await html.text(),/약속함/);
 const ws=await socket(f,a,r.id),closed=new Promise(resolve=>ws.addEventListener('close',resolve));ws.send('x'.repeat(4097));await closed;
});

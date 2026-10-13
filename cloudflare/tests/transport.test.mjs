import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,login,room,request,socket,frame,passwordFor} from './helpers.mjs';
test('unique credentials cannot be used for another identity, duplicate cookies fail closed and profiles contain no secrets',async t=>{
 const f=await fixture(t),a=await login(f);assert.equal((await request(f,'/api/login',{method:'POST',data:{handle:'synthetic-1',password:passwordFor(0)}})).status,401);
 assert.equal((await request(f,'/api/session',{user:{...a,cookie:a.cookie+'; '+a.cookie}})).status,401);const users=await request(f,'/api/users',{user:a});assert.ok(users.body.users.every(u=>!('handle'in u)&&!('password_hash'in u)&&!('salt'in u)));
});
test('session idle and absolute expiration survives DO recreation',async t=>{
 const f=await fixture(t),a=await login(f);await f.restart({SESSION_IDLE_MS:'1'});assert.equal((await request(f,'/api/session',{user:a})).status,401);
});
test('stale candidate edits and ignore protect confirmation; malformed date/version/ID/query fail',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,[a,b]);
 const sample={title:'따뜻한 만남',date:'2026-10-20',time:'14:00',endTime:'15:00',place:'합성 장소',notes:''};
 assert.equal((await request(f,`/api/rooms/${r.id}/proposals`,{user:a,method:'POST',data:{...sample,date:'2026-02-30'}})).status,422);const p=(await request(f,`/api/rooms/${r.id}/proposals`,{user:a,method:'POST',data:sample})).body.proposal;
 assert.equal((await request(f,`/api/proposals/${p.id}/edit`,{user:a,method:'POST',data:{expectedVersion:1,payload:{...sample,title:'수정'}}})).status,200);
 assert.equal((await request(f,`/api/proposals/${p.id}/confirm`,{user:a,method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}})).status,409);assert.equal((await request(f,`/api/proposals/${p.id}/ignore`,{user:a,method:'POST',data:{expectedVersion:2}})).status,200);
 assert.equal((await request(f,`/api/proposals/${p.id}/confirm`,{user:a,method:'POST',data:{expectedVersion:3,decision:'CONFIRM'}})).status,409);assert.equal((await request(f,'/api/promises',{user:a})).body.promises.length,0);
 assert.equal((await request(f,`/api/rooms/${r.id}/messages?after=-1`,{user:a})).status,422);assert.equal((await request(f,`/api/rooms/${r.id}/messages?after=0&after=1`,{user:a})).status,422);assert.equal((await request(f,'/api/rooms/INVALID',{user:a})).status,422);
});
test('WebSocket frames cannot impersonate or persist messages; three actors still have independent sessions',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),c=await login(f,2),r=await room(f,[a,b,c]),ws=await socket(f,a,r.id),closed=new Promise(resolve=>ws.addEventListener('close',resolve));ws.send(JSON.stringify({type:'message',userId:b.id,text:'사칭'}));await closed;assert.equal((await request(f,`/api/rooms/${r.id}`,{user:b})).body.messages.length,0);
 const remaining=await socket(f,c,r.id),pong=frame(remaining);remaining.send('{"type":"ping"}');assert.equal((await pong).type,'pong');remaining.close();
});
test('external hostname and MODE deny deployment rather than trusting headers',async t=>{
 const f=await fixture(t);assert.equal((await f.mf.dispatchFetch('https://public.invalid/api/login')).status,503);await f.restart({MODE:'private-staging'});assert.equal((await f.mf.dispatchFetch(f.origin+'/')).status,503);
});

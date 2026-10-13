import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,login,room,request,socket,frame,sample,maintenance} from './helpers.mjs';
test('Cloudflare runtime: three independent authenticated actors send live group messages, reconnect, and direct chat',async t=>{
 const f=await fixture(t),users=await Promise.all([login(f),login(f,1),login(f,2)]),r=await room(f,users),sockets=await Promise.all(users.map(u=>socket(f,u,r.id)));
 for(const [i,user]of users.entries()){const frames=sockets.map(frame);assert.equal((await request(f,`/api/rooms/${r.id}/messages`,{user,method:'POST',data:{clientMessageId:crypto.randomUUID(),text:'합성 채팅 '+i}})).status,201);assert.ok((await Promise.all(frames)).every(v=>v.roomId===r.id));}
 for(const user of users)assert.equal((await request(f,`/api/rooms/${r.id}`,{user})).body.messages.length,3);
 sockets[1].close();const again=await socket(f,users[1],r.id),pong=frame(again);again.send('{"type":"ping"}');assert.equal((await pong).type,'pong');again.close();for(const ws of [sockets[0],sockets[2]])ws.close();
 const direct=await room(f,users.slice(0,2)),sa=await socket(f,users[0],direct.id),sb=await socket(f,users[1],direct.id),events=[frame(sa),frame(sb)];const sent=await request(f,`/api/rooms/${direct.id}/messages`,{user:users[0],method:'POST',data:{clientMessageId:crypto.randomUUID(),text:'1:1 수신 확인'}});await Promise.all(events);
 assert.equal((await request(f,`/api/rooms/${direct.id}/receipts`,{user:users[1],method:'POST',data:{messageIds:[sent.body.message.id]}})).status,200);sa.close();sb.close();
});
test('explicit approval, duplicate confirmation, independent RSVP and change/cancel approval on DO SQLite',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),c=await login(f,2),r=await room(f,[a,b,c]);
 const created=await request(f,`/api/rooms/${r.id}/proposals`,{user:a,method:'POST',data:sample});assert.equal(created.status,201);const id=created.body.proposal.id;
 assert.equal((await request(f,'/api/promises',{user:a})).body.promises.length,0);
 assert.equal((await request(f,`/api/proposals/${id}/confirm`,{user:a,method:'POST',data:{expectedVersion:1,decision:'AUTO'}})).status,422);
 assert.equal((await request(f,`/api/proposals/${id}/confirm`,{user:b,method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}})).status,403);
 const results=await Promise.all([1,2,3].map(()=>request(f,`/api/proposals/${id}/confirm`,{user:a,method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}})));assert.ok(results.every(r=>r.status===200));assert.equal(new Set(results.map(r=>r.body.promise.id)).size,1);const pid=results[0].body.promise.id;assert.ok(results[0].body.promise.attendees.every(v=>v.response==='pending'));
 await request(f,`/api/promises/${pid}/rsvp`,{user:b,method:'POST',data:{response:'going'}});await request(f,`/api/promises/${pid}/rsvp`,{user:c,method:'POST',data:{response:'declined'}});let view=(await request(f,`/api/promises/${pid}`,{user:a})).body.promise;assert.deepEqual(view.attendees.map(v=>v.response).sort(),['declined','going','pending']);
 const review=await request(f,`/api/promises/${pid}/review`,{user:a,method:'POST',data:{kind:'change',expectedVersion:1,payload:{...sample,place:'승인 이후 변경'}}});assert.equal((await request(f,`/api/promises/${pid}`,{user:a})).body.promise.payload.place,sample.place);
 const apply={reviewId:review.body.review.reviewId,decision:'CONFIRM'};assert.equal((await request(f,`/api/promises/${pid}/apply`,{user:b,method:'POST',data:apply})).status,403);assert.equal((await request(f,`/api/promises/${pid}/apply`,{user:a,method:'POST',data:{...apply,decision:'AUTO'}})).status,422);assert.equal((await request(f,`/api/promises/${pid}/apply`,{user:a,method:'POST',data:apply})).status,200);assert.equal((await request(f,`/api/promises/${pid}/apply`,{user:a,method:'POST',data:apply})).status,409);
 const cancel=await request(f,`/api/promises/${pid}/review`,{user:a,method:'POST',data:{kind:'cancel',expectedVersion:2}});assert.equal((await request(f,`/api/promises/${pid}`,{user:a})).body.promise.status,'confirmed');assert.equal((await request(f,`/api/promises/${pid}/apply`,{user:a,method:'POST',data:{reviewId:cancel.body.review.reviewId,decision:'CONFIRM'}})).body.promise.status,'cancelled');
});
test('concurrent message retries are exactly-once and conflicting or spoofed fields fail closed',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,[a,b]),data={clientMessageId:crypto.randomUUID(),text:'하나만 저장'};
 const responses=await Promise.all([1,2,3].map(()=>request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data})));assert.equal(new Set(responses.map(r=>r.body.message.id)).size,1);
 assert.equal((await request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data:{...data,text:'변조'}})).status,409);assert.equal((await request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data:{...data,userId:b.id}})).status,422);
 assert.equal((await request(f,`/api/rooms/${r.id}`,{user:b})).body.messages.length,1);
});

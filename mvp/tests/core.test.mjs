import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,login,room,request,socket,nextFrame,sample} from './helpers.mjs';

test('A and B synchronize a durable direct message and delivery receipt over actual HTTP/WS',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,a,[b]);
 const wa=await socket(f,a,r.id),wb=await socket(f,b,r.id),fa=nextFrame(wa),fb=nextFrame(wb);
 const sent=await request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data:{clientMessageId:randomUUID(),text:'A에서 B로 실제 합성 메시지'}});
 assert.equal(sent.status,201);assert.equal((await fa).roomId,r.id);assert.equal((await fb).roomId,r.id);
 const seen=await request(f,`/api/rooms/${r.id}`,{user:b});assert.equal(seen.body.messages[0].body,'A에서 B로 실제 합성 메시지');assert.equal(seen.body.messages[0].sender_id,a.id);
 const receipt=await request(f,`/api/rooms/${r.id}/receipts`,{user:b,method:'POST',data:{messageIds:[sent.body.message.id]}});assert.equal(receipt.status,200);
 const checked=await request(f,`/api/rooms/${r.id}`,{user:a});assert.ok(checked.body.messages[0].receipts.find(item=>item.user_id===b.id).delivered_at);wa.terminate();wb.terminate();
});
test('A/B/C group each transmit and receive synchronized canonical messages',async t=>{
 const f=await fixture(t),users=await Promise.all([login(f),login(f,1),login(f,2)]),r=await room(f,users[0],users.slice(1)),sockets=await Promise.all(users.map(user=>socket(f,user,r.id)));
 for(const [index,user] of users.entries()){const frames=sockets.map(ws=>nextFrame(ws));const result=await request(f,`/api/rooms/${r.id}/messages`,{user,method:'POST',data:{clientMessageId:randomUUID(),text:'그룹 사용자 '+index}});assert.equal(result.status,201);await Promise.all(frames);}
 for(const user of users){const result=await request(f,`/api/rooms/${r.id}`,{user});assert.equal(result.body.messages.length,3);assert.equal(new Set(result.body.messages.map(message=>message.sender_id)).size,3);}
 for(const ws of sockets)ws.terminate();
});
test('duplicate and concurrent retries store exactly one message, conflicting payload is rejected',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,a,[b]),data={clientMessageId:randomUUID(),text:'한 번만 저장'};
 const results=await Promise.all(Array.from({length:3},()=>request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data})));assert.equal(new Set(results.map(result=>result.body.message.id)).size,1);
 const conflict=await request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data:{...data,text:'다른 내용'}});assert.equal(conflict.status,409);assert.equal(f.app.store.get('SELECT COUNT(*) AS count FROM messages').count,1);
});
test('direct room IDs are server-issued and repeated pair creation reuses the room',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r1=await room(f,a,[b]),r2=await room(f,b,[a]);assert.equal(r1.id,r2.id);assert.ok(/^[a-f0-9-]{36}$/.test(r1.id));
 const profile=await request(f,'/api/users',{user:a});assert.ok(profile.body.users.every(user=>!('password_hash' in user)&&!('salt' in user)&&!('handle' in user)));
});
test('pending candidate creation and editing never insert a confirmed promise; ignoring keeps count zero',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,a,[b]);const created=await request(f,`/api/rooms/${r.id}/proposals`,{user:a,method:'POST',data:sample});assert.equal(created.status,201);
 const id=created.body.proposal.id;assert.equal(f.app.store.get('SELECT COUNT(*) AS count FROM promises').count,0);
 const edited=await request(f,`/api/proposals/${id}/edit`,{user:a,method:'POST',data:{expectedVersion:1,payload:{...sample,title:'미확정 수정'}}});assert.equal(edited.status,200);assert.equal(f.app.store.get('SELECT COUNT(*) AS count FROM promises').count,0);
 const ignored=await request(f,`/api/proposals/${id}/ignore`,{user:a,method:'POST',data:{expectedVersion:2}});assert.equal(ignored.status,200);assert.equal(ignored.body.proposal.status,'ignored');assert.equal(f.app.store.get('SELECT COUNT(*) AS count FROM promises').count,0);
});
test('explicit host confirmation saves exactly once and never chooses attendee responses',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),c=await login(f,2),r=await room(f,a,[b,c]);const created=await request(f,`/api/rooms/${r.id}/proposals`,{user:a,method:'POST',data:sample}),id=created.body.proposal.id;
 const noDecision=await request(f,`/api/proposals/${id}/confirm`,{user:a,method:'POST',data:{expectedVersion:1,decision:'AUTO'}});assert.equal(noDecision.status,422);assert.equal(f.app.store.get('SELECT COUNT(*) AS count FROM promises').count,0);
 const first=await request(f,`/api/proposals/${id}/confirm`,{user:a,method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}}),second=await request(f,`/api/proposals/${id}/confirm`,{user:a,method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}});assert.equal(first.status,200);assert.equal(first.body.promise.id,second.body.promise.id);assert.ok(first.body.promise.attendees.every(item=>item.response==='pending'));assert.equal(f.app.store.get('SELECT COUNT(*) AS count FROM promises').count,1);
 const promiseId=first.body.promise.id;await request(f,`/api/promises/${promiseId}/rsvp`,{user:b,method:'POST',data:{response:'going'}});await request(f,`/api/promises/${promiseId}/rsvp`,{user:c,method:'POST',data:{response:'declined'}});
 const checked=await request(f,`/api/promises/${promiseId}`,{user:a});assert.equal(checked.body.promise.attendees.find(item=>item.user_id===a.id).response,'pending');assert.equal(checked.body.promise.attendees.find(item=>item.user_id===b.id).response,'going');assert.equal(checked.body.promise.attendees.find(item=>item.user_id===c.id).response,'declined');
});
test('change and cancel reviews require explicit versioned, single-use approval',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,a,[b]);const proposal=await request(f,`/api/rooms/${r.id}/proposals`,{user:a,method:'POST',data:sample}),confirmed=await request(f,`/api/proposals/${proposal.body.proposal.id}/confirm`,{user:a,method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}}),id=confirmed.body.promise.id;
 await request(f,`/api/promises/${id}/rsvp`,{user:b,method:'POST',data:{response:'going'}});
 const review=await request(f,`/api/promises/${id}/review`,{user:a,method:'POST',data:{kind:'change',expectedVersion:1,payload:{...sample,place:'승인 후 새 장소'}}});assert.equal(review.status,200);
 let actual=await request(f,`/api/promises/${id}`,{user:a});assert.equal(actual.body.promise.payload.place,sample.place);
 const denied=await request(f,`/api/promises/${id}/apply`,{user:a,method:'POST',data:{reviewId:review.body.review.reviewId,decision:'AUTO'}});assert.equal(denied.status,422);
 const apply=await request(f,`/api/promises/${id}/apply`,{user:a,method:'POST',data:{reviewId:review.body.review.reviewId,decision:'CONFIRM'}});assert.equal(apply.status,200);assert.equal(apply.body.promise.payload.place,'승인 후 새 장소');assert.ok(apply.body.promise.attendees.every(item=>item.response==='pending'));
 const replay=await request(f,`/api/promises/${id}/apply`,{user:a,method:'POST',data:{reviewId:review.body.review.reviewId,decision:'CONFIRM'}});assert.equal(replay.status,409);
 const cancel=await request(f,`/api/promises/${id}/review`,{user:a,method:'POST',data:{kind:'cancel',expectedVersion:2}});actual=await request(f,`/api/promises/${id}`,{user:a});assert.equal(actual.body.promise.status,'confirmed');
 const done=await request(f,`/api/promises/${id}/apply`,{user:a,method:'POST',data:{reviewId:cancel.body.review.reviewId,decision:'CONFIRM'}});assert.equal(done.status,200);assert.equal(done.body.promise.status,'cancelled');assert.ok(done.body.promise.history.some(item=>item.kind==='promise.changed'));assert.ok(done.body.promise.history.some(item=>item.kind==='promise.cancelled'));
});

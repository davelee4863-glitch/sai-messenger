import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,login,room,request,sample,socket,nextFrame} from './helpers.mjs';

test('noncanonical UUID casing cannot bypass message idempotency',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,a,[b]),id=randomUUID();
 assert.equal((await request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data:{clientMessageId:id,text:'동일 전송'}})).status,201);
 assert.equal((await request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data:{clientMessageId:id.toUpperCase(),text:'동일 전송'}})).status,422);
 assert.equal(f.app.store.get('SELECT COUNT(*) AS count FROM messages').count,1);
});
test('stale candidate versions and expired approval reviews cannot create or change promises',async t=>{
 let clock=100000;const f=await fixture(t,{now:()=>clock}),a=await login(f),b=await login(f,1),r=await room(f,a,[b]);
 const p=(await request(f,`/api/rooms/${r.id}/proposals`,{user:a,method:'POST',data:sample})).body.proposal;
 await request(f,`/api/proposals/${p.id}/edit`,{user:a,method:'POST',data:{expectedVersion:1,payload:{...sample,title:'검토한 새 내용'}}});
 assert.equal((await request(f,`/api/proposals/${p.id}/confirm`,{user:a,method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}})).status,409);
 assert.equal(f.app.store.get('SELECT COUNT(*) AS count FROM promises').count,0);
 const saved=(await request(f,`/api/proposals/${p.id}/confirm`,{user:a,method:'POST',data:{expectedVersion:2,decision:'CONFIRM'}})).body.promise;
 const review=(await request(f,`/api/promises/${saved.id}/review`,{user:a,method:'POST',data:{kind:'cancel',expectedVersion:1}})).body.review;
 clock+=300001;assert.equal((await request(f,`/api/promises/${saved.id}/apply`,{user:a,method:'POST',data:{reviewId:review.reviewId,decision:'CONFIRM'}})).status,409);
 assert.equal((await request(f,`/api/promises/${saved.id}`,{user:b})).body.promise.status,'confirmed');
});
test('concurrent reviewed changes apply one version and reject the other stale review',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,a,[b]);
 const p=(await request(f,`/api/rooms/${r.id}/proposals`,{user:a,method:'POST',data:sample})).body.proposal;
 const saved=(await request(f,`/api/proposals/${p.id}/confirm`,{user:a,method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}})).body.promise;
 const reviews=await Promise.all(['변경 A','변경 B'].map(title=>request(f,`/api/promises/${saved.id}/review`,{user:a,method:'POST',data:{kind:'change',expectedVersion:1,payload:{...sample,title}}})));
 const outcomes=await Promise.all(reviews.map(result=>request(f,`/api/promises/${saved.id}/apply`,{user:a,method:'POST',data:{reviewId:result.body.review.reviewId,decision:'CONFIRM'}})));
 assert.deepEqual(outcomes.map(result=>result.status).sort(),[200,409]);assert.equal(f.app.store.get("SELECT COUNT(*) AS count FROM history WHERE kind='promise.changed'").count,1);
});
test('cross-room receipt rejection rolls back the whole batch',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),c=await login(f,2),r=await room(f,a,[b]),other=await room(f,a,[c]);
 const first=(await request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data:{clientMessageId:randomUUID(),text:'첫 방'}})).body.message;
 const second=(await request(f,`/api/rooms/${other.id}/messages`,{user:a,method:'POST',data:{clientMessageId:randomUUID(),text:'다른 방'}})).body.message;
 assert.equal((await request(f,`/api/rooms/${r.id}/receipts`,{user:b,method:'POST',data:{messageIds:[first.id,second.id]}})).status,403);
 assert.equal(f.app.store.get('SELECT delivered_at FROM message_receipts WHERE message_id=? AND user_id=?',first.id,b.id).delivered_at,null);
});
test('body size and malformed payloads fail without storing messages',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,a,[b]);
 assert.equal((await request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data:{clientMessageId:randomUUID(),text:'x'.repeat(17000)}})).status,413);
 for(const value of [null,[],{clientMessageId:randomUUID(),text:{html:'<b>bad</b>'}},{clientMessageId:randomUUID(),text:'\u0000'}])assert.equal((await request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data:value})).status,422);
 assert.equal(f.app.store.get('SELECT COUNT(*) AS count FROM messages').count,0);
});
test('WebSocket identity injection and oversized frames cannot store messages',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1),r=await room(f,a,[b]);
 for(const payload of [JSON.stringify({type:'ping',senderId:b.id}),'x'.repeat(4097)]){const ws=await socket(f,a,r.id),closed=new Promise(resolve=>ws.once('close',resolve));ws.send(payload);assert.ok([1008,1009].includes(await closed));}
 assert.equal(f.app.store.get('SELECT COUNT(*) AS count FROM messages').count,0);
});

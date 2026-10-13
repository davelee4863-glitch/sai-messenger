import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {digest} from '../../mvp/security.mjs';
import {fixture,login,room,request,sample,maintenance,runtime,passwordFor} from './helpers.mjs';
async function saved(f){const a=await login(f),b=await login(f,1),c=await login(f,2),r=await room(f,[a,b,c]);const data={clientMessageId:crypto.randomUUID(),text:'재시작 후 보존되는 합성 메시지'};await request(f,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data});const pr=await request(f,`/api/rooms/${r.id}/proposals`,{user:a,method:'POST',data:sample});const cf=await request(f,`/api/proposals/${pr.body.proposal.id}/confirm`,{user:a,method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}});assert.equal(cf.status,200);return {a,b,c,r,data,promise:cf.body.promise};}
test('dispose/restart keeps messages, explicit promises, sessions and idempotency; encrypted HTTPS URLs set Secure cookie',async t=>{
 const f=await fixture(t),v=await saved(f);await f.restart();assert.equal((await request(f,`/api/rooms/${v.r.id}`,{user:v.b})).body.messages[0].body,v.data.text);assert.equal((await request(f,`/api/promises/${v.promise.id}`,{user:v.c})).body.promise.id,v.promise.id);
 assert.equal((await request(f,`/api/rooms/${v.r.id}/messages`,{user:v.a,method:'POST',data:v.data})).body.duplicate,true);
 // dispatchFetch proves HTTPS-aware behavior; public/browser TLS trust remains separately NOT_RUN.
 await f.restart({ORIGIN:'https://localhost:8787'});f.origin='https://localhost:8787';const r=await request(f,'/api/login',{method:'POST',data:{handle:'synthetic-0',password:passwordFor(0)}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/; Secure/);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Path=\//);
});
test('checksummed logical backup restores all business rows into a new DO/D1 namespace and revokes sessions/reviews',async t=>{
 const f=await fixture(t),v=await saved(f);const review=await request(f,`/api/promises/${v.promise.id}/review`,{user:v.a,method:'POST',data:{kind:'cancel',expectedVersion:1}});const backup=await (await maintenance(f.mf,'__backup')).json();
 const persist=await mkdtemp(resolve(tmpdir(),'promise-box-cf-')),mf=await runtime({persist});t.after(async()=>{await mf.dispose();if(!resolve(persist).startsWith(resolve(tmpdir(),'promise-box-cf-')))throw new Error('Cleanup rejected');await rm(persist,{recursive:true,force:true});});const restored={mf,origin:f.origin};
 assert.equal((await maintenance(mf,'__restore',backup)).status,200);assert.equal((await request(restored,'/api/session',{user:v.a})).status,401);const a=await login(restored);assert.equal(a.id,v.a.id);
 assert.equal((await request(restored,`/api/rooms/${v.r.id}`,{user:a})).body.messages[0].body,v.data.text);assert.equal((await request(restored,'/api/promises',{user:a})).body.promises[0].id,v.promise.id);
 assert.equal((await request(restored,`/api/promises/${v.promise.id}/apply`,{user:a,method:'POST',data:{reviewId:review.body.review.reviewId,decision:'CONFIRM'}})).status,403);
 assert.equal((await maintenance(mf,'__flush')).status,200);const d1=await mf.getD1Database('META'),projection=await d1.prepare('SELECT * FROM workspace_projection').first();assert.ok(JSON.parse(projection.payload).promises.some(p=>p.id===v.promise.id));assert.equal((await maintenance(mf,'__restore',backup)).status,409);
});
test('tampered or malformed backups fail before business writes and preserve empty target',async t=>{
 const f=await fixture(t),backup=await (await maintenance(f.mf,'__backup')).json();const persist=await mkdtemp(resolve(tmpdir(),'promise-box-cf-')),mf=await runtime({persist});t.after(async()=>{await mf.dispose();if(!resolve(persist).startsWith(resolve(tmpdir(),'promise-box-cf-')))throw new Error('Cleanup rejected');await rm(persist,{recursive:true,force:true});});backup.tables.users[0].nickname='손상';assert.equal((await maintenance(mf,'__restore',backup)).status,422);assert.equal((await (await maintenance(mf,'__backup')).json()).tables.users.length,0);
});
test('correctly checksummed unsupported schema/epoch rejects before import and survives target recreation',async t=>{
 const f=await fixture(t),backup=await (await maintenance(f.mf,'__backup')).json();const persist=await mkdtemp(resolve(tmpdir(),'promise-box-cf-'));let mf=await runtime({persist});t.after(async()=>{await mf.dispose();if(!resolve(persist).startsWith(resolve(tmpdir(),'promise-box-cf-')))throw new Error('Cleanup rejected');await rm(persist,{recursive:true,force:true});});
 for(const [key,value]of [['schema','cf-v-invalid'],['epoch','NaN'],['epoch','0'],['epoch','9007199254740991']]){const bad=structuredClone(backup);bad.tables.cf_meta.find(r=>r.key===key).value=value;bad.checksum=digest(JSON.stringify({format:bad.format,createdAt:bad.createdAt,tables:bad.tables}));assert.equal((await maintenance(mf,'__restore',bad)).status,422);assert.equal((await (await maintenance(mf,'__backup')).json()).tables.users.length,0);}
 await mf.dispose();mf=await runtime({persist});assert.equal((await mf.dispatchFetch('http://localhost:8787/health')).status,200);assert.equal((await maintenance(mf,'__restore',backup)).status,200);
});
test('D1 failure leaves durable outbox; retry/restart reconciles and untrusted metadata cannot authorize rooms',async t=>{
 const f=await fixture(t,{bindings:{D1_FAILURE:'true'}}),v=await saved(f);let met=await (await maintenance(f.mf,'__metrics')).json();assert.ok(met.pending>0);assert.equal((await (await maintenance(f.mf,'__flush')).json()).synced,false);
 await f.restart({D1_FAILURE:'false'});const flushed=await (await maintenance(f.mf,'__flush')).json();assert.equal(flushed.synced,true);assert.equal(flushed.pending,0);const d1=await f.mf.getD1Database('META'),row=await d1.prepare('SELECT * FROM workspace_projection').first();assert.equal(JSON.parse(row.payload).promises.filter(p=>p.id===v.promise.id).length,1);
 await d1.prepare("UPDATE workspace_projection SET payload='{}',revision=999999").run();const d=await login(f,3);assert.equal((await request(f,`/api/rooms/${v.r.id}`,{user:d})).status,403);assert.equal((await request(f,`/api/promises/${v.promise.id}`,{user:v.a})).status,200);
});
test('free-budget pause and mid-transaction row limit never partially insert a message or promise',async t=>{
 const f=await fixture(t),v=await saved(f);await f.restart({QUOTA_PAUSED:'true'});let denied=await request(f,`/api/rooms/${v.r.id}/messages`,{user:v.a,method:'POST',data:{clientMessageId:crypto.randomUUID(),text:'저장하면 안 됨'}});assert.equal(denied.status,503);assert.equal(denied.body.error.code,'FREE_QUOTA_PAUSED');await f.restart({QUOTA_PAUSED:'false'});
 assert.equal((await request(f,`/api/rooms/${v.r.id}`,{user:v.a})).body.messages.length,1);const candidate=await request(f,`/api/rooms/${v.r.id}/proposals`,{user:v.a,method:'POST',data:{...sample,title:'한도 중 미확정'}});assert.equal(candidate.status,201);
 const metric=await (await maintenance(f.mf,'__metrics')).json(),used=metric.usage[0].writes;await f.restart({WRITE_BUDGET:String(used+11)});denied=await request(f,`/api/proposals/${candidate.body.proposal.id}/confirm`,{user:v.a,method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}});assert.equal(denied.status,503);await f.restart({WRITE_BUDGET:'80000'});
 const snapshot=(await request(f,`/api/rooms/${v.r.id}`,{user:v.a})).body;assert.equal(snapshot.promises.length,1);assert.equal(snapshot.proposals.find(p=>p.id===candidate.body.proposal.id).status,'pending');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,login,room,request,maintenance} from './helpers.mjs';
import {BINDINGS} from '../isolation-identity.mjs';
test('D1 refuses stale revision: outbox is retained until exact projection acknowledgement',async t=>{
 const f=await fixture(t),a=await login(f),b=await login(f,1);await maintenance(f.mf,'__flush');const d1=await f.mf.getD1Database(BINDINGS.metadata);await d1.prepare("UPDATE workspace_projection SET revision=999999,payload='{}'").run();
 await room(f,[a,b]);const flush=await (await maintenance(f.mf,'__flush')).json();assert.equal(flush.synced,false);assert.ok(flush.pending>0);
 const rebuilt=await (await maintenance(f.mf,'__rebuild-meta',{})).json();assert.equal(rebuilt.synced,true);assert.equal(rebuilt.pending,0);const row=await d1.prepare('SELECT * FROM workspace_projection').first();assert.ok(row.revision<999999);assert.equal(JSON.parse(row.payload).users.length,4);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rm,symlink,link,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {digest} from '../../mvp/security.mjs';
import {APP_ID,NAMESPACE,BINDINGS,WORKER_NAME,WORKSPACE_NAME,D1_ID,DO_CLASS,OWNERSHIP,assertWorkerEnvironment} from '../isolation-identity.mjs';
import {MARKER,ownPersistence,runtimeOptions} from '../local-isolation.mjs';
import {fixture,login,room,request,maintenance,runtime} from './helpers.mjs';
// Windows workerd cannot open SQLite below long checkout paths; keep owned emulator fixtures short.
const fixtureRoot=resolve(tmpdir(),'pbx-cf-isolation-fixtures'),disposers=new Map();
async function ownedFixture(t){await mkdir(fixtureRoot,{recursive:true});const dir=await mkdtemp(join(fixtureRoot,'run-'));disposers.set(dir,[]);t.after(async()=>{for(const dispose of disposers.get(dir))await dispose();disposers.delete(dir);const path=relative(fixtureRoot,dir);if(!path||path.startsWith('..')||isAbsolute(path))throw new Error('Fixture cleanup boundary rejected');await rm(dir,{recursive:true,force:true});});return dir;}
function disposeBeforeCleanup(dir,dispose){disposers.get(dir).push(dispose);}
function checksum(snapshot){return digest(JSON.stringify({format:snapshot.format,owner:snapshot.owner,createdAt:snapshot.createdAt,tables:snapshot.tables}));}
function environment(){return {MODE:'local',ORIGIN:'http://localhost:8787',PBX_CF_APP_ID:APP_ID,PBX_CF_NAMESPACE:NAMESPACE,[BINDINGS.workspace]:{idFromName(){},get(){}},[BINDINGS.metadata]:{prepare(){}},[BINDINGS.assets]:{fetch(){}}};}

test('dedicated worker, object, metadata, class and binding identities are exact and immutable',()=>{
 assert.equal(APP_ID,'davelee4863-glitch/sai-messenger:promise-box');assert.equal(NAMESPACE,'promise-box-sai-cf-dev-80f5fa37c2e8');
 assert.equal(WORKER_NAME,NAMESPACE+'-worker');assert.equal(WORKSPACE_NAME,NAMESPACE+'-workspace');assert.equal(D1_ID,'local:'+NAMESPACE+':meta');assert.equal(DO_CLASS,'PBXWorkspace');
 assert.deepEqual(BINDINGS,{workspace:'PBX_CF_WORKSPACE',metadata:'PBX_CF_META',assets:'PBX_CF_ASSETS'});assert.ok(Object.isFrozen(BINDINGS));assert.ok(Object.isFrozen(OWNERSHIP));
});

test('foreign or immutable runtime bindings fail before creating any persistence',async t=>{
 const dir=await ownedFixture(t);const persist=resolve(dir,'must-not-exist');
 for(const key of ['MODE','ORIGIN','PBX_CF_APP_ID','PBX_CF_NAMESPACE','WORKSPACE','META','ASSETS',...Object.values(BINDINGS),'R2','KV','QUEUE','OTHER_APP_SECRET','CLOUDFLARE_API_TOKEN','DATABASE_ID','services','vars']){
  await assert.rejects(runtime({persist,bindings:{[key]:'foreign-app'}}),/isolation/);assert.deepEqual(await readdir(dir),[]);
 }
 for(const extra of [{env:{META:'other-app'}},{durableObjects:{FOREIGN:{className:'Other'}}},{d1Databases:{META:'foreign'}},{remote:true},{bindings:Object.assign(Object.create({META:'foreign'}),{WRITE_BUDGET:'1'})}])await assert.rejects(runtime({persist,...extra}),/isolation/);
 const getter={};Object.defineProperty(getter,'WRITE_BUDGET',{enumerable:true,get(){throw new Error('Getter must never execute');}});assert.throws(()=>runtimeOptions({persist,bindings:getter}),/unsupported property/);
 assert.deepEqual(await readdir(dir),[]);
});

test('Worker and direct DO environment checks reject foreign aliases, missing identities and extra capabilities',()=>{
 assert.doesNotThrow(()=>assertWorkerEnvironment(environment()));
 for(const key of ['WORKSPACE','META','ASSETS','OTHER_APP_KV','OTHER_APP_R2','OTHER_APP_QUEUE','OTHER_APP_SECRET','SERVICE','ROUTE','DOMAIN'])assert.throws(()=>assertWorkerEnvironment({...environment(),[key]:{}}),/isolation/);
 for(const key of ['PBX_CF_APP_ID','PBX_CF_NAMESPACE',...Object.values(BINDINGS)]){const env=environment();delete env[key];assert.throws(()=>assertWorkerEnvironment(env),/isolation/);}
 for(const key of ['PBX_CF_APP_ID','PBX_CF_NAMESPACE'])assert.throws(()=>assertWorkerEnvironment({...environment(),[key]:'foreign-app'}),/isolation/);
 assert.throws(()=>assertWorkerEnvironment({...environment(),MODE:'private-staging'}),/isolation/);
 assert.throws(()=>assertWorkerEnvironment(Object.assign(Object.create({OTHER_APP_SECRET:'foreign'}),environment())),/isolation/);
 const hidden=environment();Object.defineProperty(hidden,'WRITE_BUDGET',{value:'1',enumerable:false});assert.throws(()=>assertWorkerEnvironment(hidden),/isolation/);
 const getter=environment();Object.defineProperty(getter,'WRITE_BUDGET',{enumerable:true,get(){throw new Error('Getter must never execute');}});assert.throws(()=>assertWorkerEnvironment(getter),/isolation/);
});

test('nonempty unmarked or foreign marked storage is refused without altering foreign bytes',async t=>{
 const dir=await ownedFixture(t),foreign=resolve(dir,'foreign');await mkdir(foreign);const sentinel=resolve(foreign,'database.sqlite');const bytes=Buffer.from('Existing application private state\0v1');await writeFile(sentinel,bytes);
 await assert.rejects(runtime({persist:foreign}),/nonempty unmarked/);assert.deepEqual(await readdir(foreign),['database.sqlite']);assert.deepEqual(await readFile(sentinel),bytes);
 await writeFile(resolve(foreign,MARKER),JSON.stringify({...OWNERSHIP,namespace:'other-app'}));const before=await readFile(resolve(foreign,MARKER));await assert.rejects(runtime({persist:foreign}),/foreign persistence ownership/);assert.deepEqual(await readFile(resolve(foreign,MARKER)),before);assert.deepEqual(await readFile(sentinel),bytes);
});

test('owned persistence rejects symlink targets, ancestors and linked entries without opening their destination',async t=>{
 const dir=await ownedFixture(t),foreign=resolve(dir,'foreign');await mkdir(foreign);await writeFile(resolve(foreign,'sentinel'),'foreign unchanged');
 const link=resolve(dir,'link');await symlink(foreign,link,process.platform==='win32'?'junction':'dir');
 await assert.rejects(runtime({persist:link}),/linked persistence/);await assert.rejects(runtime({persist:resolve(link,'new-child')}),/linked persistence/);
 const owned=resolve(dir,'owned');ownPersistence(owned);await symlink(foreign,resolve(owned,'foreign-link'),process.platform==='win32'?'junction':'dir');await assert.rejects(runtime({persist:owned}),/linked persistence/);
 assert.deepEqual(await readdir(foreign),['sentinel']);assert.equal(await readFile(resolve(foreign,'sentinel'),'utf8'),'foreign unchanged');
});

test('hardlinked foreign storage and ownership markers are rejected before writes to shared inodes',async t=>{
 const dir=await ownedFixture(t),foreign=resolve(dir,'foreign');await mkdir(foreign);const sentinel=resolve(foreign,'database.sqlite');const before=Buffer.from('foreign hardlinked database must remain unchanged');await writeFile(sentinel,before);
 const owned=resolve(dir,'owned');ownPersistence(owned);const linked=resolve(owned,'workspace.sqlite');await link(sentinel,linked);await assert.rejects(runtime({persist:owned}),/linked persistence/);assert.deepEqual(await readFile(sentinel),before);
 await unlink(linked);const marker=resolve(owned,MARKER),otherMarker=resolve(foreign,'owner-marker');const markerBefore=await readFile(marker);await link(marker,otherMarker);await assert.rejects(runtime({persist:owned}),/linked persistence/);assert.deepEqual(await readFile(otherMarker),markerBefore);assert.deepEqual(await readFile(sentinel),before);
});

test('marked parent and nested storage roots cannot overlap owned persistence',async t=>{
 const dir=await ownedFixture(t);
 for(const owner of [OWNERSHIP,{...OWNERSHIP,namespace:'other-app'}]){const parent=resolve(dir,owner.namespace===NAMESPACE?'owned-parent':'foreign-parent');await mkdir(parent);const marker=resolve(parent,MARKER);await writeFile(marker,JSON.stringify(owner));await writeFile(resolve(parent,'sentinel'),'existing parent untouched');const before=(await readdir(parent)).sort();
  await assert.rejects(runtime({persist:resolve(parent,'new-child')}),/overlaps another storage root/);assert.deepEqual((await readdir(parent)).sort(),before);assert.equal(await readFile(marker,'utf8'),JSON.stringify(owner));assert.equal(await readFile(resolve(parent,'sentinel'),'utf8'),'existing parent untouched');
 }
 const owned=resolve(dir,'owned');ownPersistence(owned);const nested=resolve(owned,'do');await mkdir(nested);await writeFile(resolve(nested,MARKER),JSON.stringify({...OWNERSHIP,namespace:'other-app'}));const before=await readFile(resolve(nested,MARKER));await assert.rejects(runtime({persist:owned}),/overlaps a nested storage root/);assert.deepEqual(await readFile(resolve(nested,MARKER)),before);
});

test('ownership is persisted before startup and old generic resource aliases are unavailable',async t=>{
 const dir=await ownedFixture(t),persist=resolve(dir,'owned'),mf=await runtime({persist});disposeBeforeCleanup(dir,()=>mf.dispose());
 assert.deepEqual(JSON.parse(await readFile(resolve(persist,MARKER),'utf8')),OWNERSHIP);assert.equal((await mf.dispatchFetch('http://localhost:8787/health')).status,200);
 for(const name of ['WORKSPACE','META']){if(name==='WORKSPACE')await assert.rejects(mf.getDurableObjectNamespace(name));else await assert.rejects(mf.getD1Database(name));}
 assert.ok(await mf.getDurableObjectNamespace(BINDINGS.workspace));assert.ok(await mf.getD1Database(BINDINGS.metadata));
});

test('foreign or absent backup ownership fails even with a recomputed checksum and leaves the new target unchanged',async t=>{
 const source=await fixture(t),snapshot=await (await maintenance(source.mf,'__backup')).json();const dir=await ownedFixture(t),target=await runtime({persist:resolve(dir,'recovery')});disposeBeforeCleanup(dir,()=>target.dispose());
 const before=(await (await maintenance(target,'__backup')).json()).tables;
 for(const owner of [undefined,null,{...OWNERSHIP,appId:'foreign-app'},{...OWNERSHIP,namespace:'other-app'},{...OWNERSHIP,schemaVersion:2},{...OWNERSHIP,extra:'foreign'}]){
  const foreign=structuredClone(snapshot);foreign.owner=owner;foreign.checksum=checksum(foreign);assert.equal((await maintenance(target,'__restore',foreign)).status,422);assert.deepEqual((await (await maintenance(target,'__backup')).json()).tables,before);
 }
});

test('local rollback restores owned data to a new store, revokes sessions, rejects repeat restore and preserves foreign data and logs',async t=>{
 const source=await fixture(t),a=await login(source),b=await login(source,1),r=await room(source,[a,b]);const original={clientMessageId:crypto.randomUUID(),text:'Owned state before local rollback'};
 assert.equal((await request(source,`/api/rooms/${r.id}/messages`,{user:a,method:'POST',data:original})).status,201);const snapshot=await (await maintenance(source.mf,'__backup')).json();assert.deepEqual(snapshot.owner,OWNERSHIP);
 const dir=await ownedFixture(t),foreign=resolve(dir,'other-app');await mkdir(foreign);const foreignState=Buffer.from('Foreign Worker/D1/DO/R2/KV/Queue state'),foreignLogs=Buffer.from('Foreign logs must stay byte-identical');await writeFile(resolve(foreign,'state'),foreignState);await writeFile(resolve(foreign,'logs'),foreignLogs);
 let target=await runtime({persist:resolve(dir,'owned-recovery')});disposeBeforeCleanup(dir,()=>target.dispose());assert.equal((await maintenance(target,'__restore',snapshot)).status,200);
 const restored={mf:target,origin:source.origin};assert.equal((await request(restored,'/api/session',{user:a})).status,401);const recovered=await login(restored);assert.equal((await request(restored,`/api/rooms/${r.id}`,{user:recovered})).body.messages[0].body,original.text);
 assert.equal((await maintenance(target,'__flush')).status,200);const ownedBefore=(await (await maintenance(target,'__backup')).json()).tables;assert.equal((await maintenance(target,'__restore',snapshot)).status,409);assert.deepEqual((await (await maintenance(target,'__backup')).json()).tables,ownedBefore);
 await target.dispose();target=await runtime({persist:resolve(dir,'owned-recovery')});restored.mf=target;assert.equal((await request(restored,`/api/rooms/${r.id}`,{user:recovered})).body.messages[0].body,original.text);
 assert.deepEqual(await readFile(resolve(foreign,'state')),foreignState);assert.deepEqual(await readFile(resolve(foreign,'logs')),foreignLogs);assert.deepEqual((await readdir(foreign)).sort(),['logs','state']);
});

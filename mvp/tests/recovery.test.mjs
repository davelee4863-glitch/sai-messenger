import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {provisionSynthetic} from '../provision.mjs';
import {Store} from '../store.mjs';
import {restoreBackup} from '../restore.mjs';
import {login,room,request,sample,socket,nextFrame} from './helpers.mjs';
const entry=fileURLToPath(new URL('../server.mjs',import.meta.url));
async function start(dbFile){const env={MVP_SQLITE_FILE:dbFile,MVP_PORT:'0',MVP_HOST:'127.0.0.1',MVP_EXTERNAL_API:'off'};for(const name of ['PATH','SystemRoot','TEMP','TMP'])if(process.env[name])env[name]=process.env[name];const child=spawn(process.execPath,[entry],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});let output='';const address=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Owned test server did not start'));},5000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error('Owned server exited before ready: '+code));});child.stdout.on('data',chunk=>{output+=chunk.toString();for(const line of output.split('\n'))try{const value=JSON.parse(line);if(value.event==='mvp.ready'){clearTimeout(timer);resolve({url:'http://127.0.0.1:'+value.port});return;}}catch{}});});return {child,...address};}
async function stop(child,signal='SIGTERM'){if(child.exitCode!==null||child.signalCode)return;const done=once(child,'exit');child.kill(signal);await done;}
test('three-user committed messages/promise/RSVP survive an actual killed server process and backup restore',async t=>{
 const dir=mkdtempSync(resolve(tmpdir(),'promise-box-recovery-')),dbFile=resolve(dir,'data/core.sqlite'),credentials=resolve(dir,'private/test-credentials.json'),processes=[];
 t.after(async()=>{for(const child of processes)await stop(child,'SIGKILL');if(!resolve(dir).startsWith(resolve(tmpdir())+sep))throw new Error('Invalid recovery fixture cleanup path');rmSync(dir,{recursive:true,force:true});});
 await provisionSynthetic(dbFile,credentials);const accounts=JSON.parse(readFileSync(credentials,'utf8')).accounts;let current=await start(dbFile);processes.push(current.child);let f={url:current.url,accounts};
 const users=await Promise.all([login(f),login(f,1),login(f,2)]),r=await room(f,users[0],users.slice(1));const sockets=await Promise.all(users.map(user=>socket(f,user,r.id)));
 for(const [index,user] of users.entries()){const frames=sockets.map(ws=>nextFrame(ws));assert.equal((await request(f,`/api/rooms/${r.id}/messages`,{user,method:'POST',data:{clientMessageId:randomUUID(),text:'재시작 보존 그룹 메시지 '+index}})).status,201);await Promise.all(frames);}
 const proposed=await request(f,`/api/rooms/${r.id}/proposals`,{user:users[0],method:'POST',data:sample}),promise=(await request(f,`/api/proposals/${proposed.body.proposal.id}/confirm`,{user:users[0],method:'POST',data:{expectedVersion:1,decision:'CONFIRM'}})).body.promise;
 await request(f,`/api/promises/${promise.id}/rsvp`,{user:users[1],method:'POST',data:{response:'going'}});await request(f,`/api/promises/${promise.id}/rsvp`,{user:users[2],method:'POST',data:{response:'declined'}});
 const before=await request(f,`/api/rooms/${r.id}`,{user:users[0]});const ids=before.body.messages.map(message=>message.id);for(const ws of sockets)ws.terminate();await stop(current.child,'SIGKILL');
 current=await start(dbFile);processes.push(current.child);f={url:current.url,accounts};
 for(const user of users){const restored=await request(f,`/api/rooms/${r.id}`,{user});assert.equal(restored.status,200);assert.deepEqual(restored.body.messages.map(message=>message.id),ids);assert.equal(restored.body.promises[0].id,promise.id);assert.equal(restored.body.promises[0].attendees.find(item=>item.user_id===users[1].id).response,'going');assert.equal(restored.body.promises[0].attendees.find(item=>item.user_id===users[2].id).response,'declined');}
 await stop(current.child);const store=new Store(dbFile),backup=resolve(dir,'backups/snapshot.sqlite');assert.equal(store.backup(backup).integrity,'ok');store.close();const copied=resolve(dir,'restored/core.sqlite');assert.equal(restoreBackup(backup,copied).sessionsRevoked,true);
 current=await start(copied);processes.push(current.child);f={url:current.url,accounts};assert.equal((await request(f,'/api/session',{user:users[0]})).status,401);const fresh=await login(f);const restored=await request(f,`/api/rooms/${r.id}`,{user:fresh});assert.equal(restored.status,200);assert.deepEqual(restored.body.messages.map(message=>message.id),ids);assert.equal(restored.body.promises[0].id,promise.id);assert.ok(restored.body.promises[0].history.some(item=>item.kind==='promise.confirmed'));
});
test('backup and restoration never overwrite an existing file',async t=>{const dir=mkdtempSync(resolve(tmpdir(),'promise-box-backup-'));t.after(()=>{if(!resolve(dir).startsWith(resolve(tmpdir())+sep))throw new Error('Invalid cleanup path');rmSync(dir,{recursive:true,force:true});});const original=resolve(dir,'original.sqlite'),copy=resolve(dir,'snapshot.sqlite'),store=new Store(original);assert.equal(store.backup(copy).integrity,'ok');assert.throws(()=>store.backup(copy),/new and separate/);store.close();assert.throws(()=>restoreBackup(copy,original),/never overwrite/);});

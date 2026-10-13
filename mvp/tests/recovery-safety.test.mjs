import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../store.mjs';
import {restoreBackup} from '../restore.mjs';
import {provisionSynthetic} from '../provision.mjs';
function scratch(t){const dir=mkdtempSync(resolve(tmpdir(),'promise-box-safety-'));t.after(()=>{if(!dir.startsWith(resolve(tmpdir())+sep))throw new Error('Unsafe cleanup');rmSync(dir,{recursive:true,force:true});});return dir;}
test('backup of a missing source fails without creating source or output',t=>{
 const dir=scratch(t),source=resolve(dir,'missing.sqlite'),output=resolve(dir,'copy.sqlite');const run=spawnSync(process.execPath,[fileURLToPath(new URL('../backup.mjs',import.meta.url)),'--db',source,'--output',output],{encoding:'utf8',windowsHide:true});assert.notEqual(run.status,0);assert.equal(existsSync(source),false);assert.equal(existsSync(output),false);
});
test('marker-only and altered schemas are rejected before startup or restoration',t=>{
 const dir=scratch(t);for(const [index,ddl]of ['PRAGMA user_version=1;','CREATE TABLE users(id TEXT PRIMARY KEY); PRAGMA user_version=1;'].entries()){const source=resolve(dir,'bad-'+index+'.sqlite'),target=resolve(dir,'restore-'+index+'.sqlite'),db=new DatabaseSync(source);db.exec(ddl);db.close();assert.throws(()=>new Store(source),/schema/i);assert.throws(()=>restoreBackup(source,target),/schema/i);assert.equal(existsSync(target),false);}
});
test('failed credentials destination leaves no users and can be retried safely',async t=>{
 const dir=scratch(t),database=resolve(dir,'data/core.sqlite'),blocked=resolve(dir,'not-a-directory'),good=resolve(dir,'private/test-credentials.json');writeFileSync(blocked,'blocking synthetic fixture');
 await assert.rejects(provisionSynthetic(database,resolve(blocked,'test-credentials.json')));if(existsSync(database)){const store=new Store(database);try{assert.equal(store.users().length,0);}finally{store.close();}}
 assert.equal((await provisionSynthetic(database,good)).userCount,4);
});
test('equivalent schema whitespace and checkout line endings remain recoverable',t=>{
 const dir=scratch(t),source=resolve(dir,'crlf.sqlite'),target=resolve(dir,'restored.sqlite'),db=new DatabaseSync(source);db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8').replace(/\r?\n/g,'\r\n'));db.close();const store=new Store(source);assert.equal(store.users().length,0);store.close();assert.equal(restoreBackup(source,target).restored,true);
});
test('existing empty files cannot be silently initialized as a successful backup',t=>{
 const dir=scratch(t),source=resolve(dir,'empty.sqlite'),target=resolve(dir,'copy.sqlite');writeFileSync(source,'');
 const before=readFileSync(source);const run=spawnSync(process.execPath,[fileURLToPath(new URL('../backup.mjs',import.meta.url)),'--db',source,'--output',target],{encoding:'utf8',windowsHide:true});assert.notEqual(run.status,0);assert.deepEqual(readFileSync(source),before);assert.equal(existsSync(target),false);
});
test('non-internal trigger names resembling sqlite prefixes cannot escape schema validation',t=>{
 const dir=scratch(t),source=resolve(dir,'trigger.sqlite'),target=resolve(dir,'copy.sqlite'),store=new Store(source);store.run("CREATE TRIGGER sqlitex_review_probe AFTER INSERT ON history BEGIN SELECT 1; END");store.close();
 assert.throws(()=>new Store(source),/schema/i);assert.throws(()=>restoreBackup(source,target),/schema/i);assert.equal(existsSync(target),false);
});

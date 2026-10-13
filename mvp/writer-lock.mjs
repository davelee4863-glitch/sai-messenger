import {openSync,writeFileSync,fsyncSync,closeSync,readFileSync,unlinkSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {safeDataPath} from './store.mjs';
function dead(owner){if(owner.host!==hostname()||!Number.isSafeInteger(owner.pid)||owner.pid<1)throw new Error('Cannot establish previous writer identity; control-plane recovery required');try{process.kill(owner.pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}}
export function acquireWriter(filename,{mode='private-staging',reclaimDeadLocal=false}={}){const path=safeDataPath(filename+'.writer.lock');mkdirSync(dirname(path),{recursive:true,mode:0o700});let fd;
 try{fd=openSync(path,'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;
  if(!reclaimDeadLocal)throw new Error('Database writer lock exists; stop the previous process and perform reviewed offline recovery');
  // Serialize local-only stale recovery. A crashed recovery guard also fails closed.
  const guard=safeDataPath(path+'.recovery');let recovery;try{recovery=openSync(guard,'wx',0o600);}catch{throw new Error('Database writer lock exists; recovery is already owned');}
  try{const old=JSON.parse(readFileSync(path,'utf8'));if(old.mode!=='local'||!dead(old))throw new Error('Database writer lock exists; active or staging writer requires offline recovery');unlinkSync(path);fd=openSync(path,'wx',0o600);}finally{closeSync(recovery);unlinkSync(guard);}
 }
 const owner={pid:process.pid,host:hostname(),nonce:randomUUID(),mode};try{writeFileSync(fd,JSON.stringify(owner));fsyncSync(fd);}finally{closeSync(fd);}return ()=>{if(readFileSync(path,'utf8')!==JSON.stringify(owner))throw new Error('Writer lock ownership changed');unlinkSync(path);};}
export function unlockStoppedWriter(filename){const path=safeDataPath(filename+'.writer.lock'),owner=JSON.parse(readFileSync(path,'utf8'));if(!dead(owner))throw new Error('Previous writer is still alive; never unlock an active database');unlinkSync(path);return {unlocked:true};}

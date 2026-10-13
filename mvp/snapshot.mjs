import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync,openSync,closeSync,chmodSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {safeDataPath,validateDatabase} from './store.mjs';
export async function copySnapshot(source,destination,validate=validateDatabase){
 const file=safeDataPath(source),target=safeDataPath(destination);
 if(!existsSync(file)||file===target||existsSync(target))throw new Error('Snapshot requires an existing source and a new destination');
 const db=new DatabaseSync(file,{readOnly:true,allowExtension:false});let reserved=false;
 try{validate(db);mkdirSync(dirname(target),{recursive:true,mode:0o700});closeSync(openSync(target,'wx',0o600));reserved=true;await backup(db,target);chmodSync(target,0o600);
  const check=new DatabaseSync(target,{readOnly:true,allowExtension:false});try{validate(check);}finally{check.close();}return target;
 }catch(error){if(reserved)unlinkSync(target);throw error;}finally{db.close();}
}

import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,lstatSync,existsSync,chmodSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {BusinessStore} from './business.mjs';
import {fileURLToPath} from 'node:url';
import {appointment,fail,text,uuid,version} from './security.mjs';
const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
const schemaRows=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all().map(row=>({...row,sql:row.sql?.replace(/\s+/g,' ').trim()}));
const expectedSchema=(()=>{const db=new DatabaseSync(':memory:');try{db.exec(schema);return JSON.stringify(schemaRows(db));}finally{db.close();}})();
export function validateDatabase(db){if(db.prepare('PRAGMA user_version').get().user_version!==2||JSON.stringify(schemaRows(db))!==expectedSchema)throw new Error('Unsupported or incomplete database schema; do not repair or overwrite it');if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Database integrity or foreign-key check failed');}
export function safeDataPath(filename) {
 if(typeof filename!=='string'||!filename.trim()||filename===':memory:')throw new Error('An explicit isolated SQLite file is required');
 const path=resolve(filename), comparable=value=>process.platform==='win32'?value.toLowerCase():value;
 for(const sub of ['docs','public','mvp/client','harness','tests']){const blocked=comparable(resolve(repo,sub)),target=comparable(path);if(target===blocked||target.startsWith(blocked+sep))throw new Error('Data cannot be placed in source or publication directories');}
 for(let current=path;;current=dirname(current)){try{const info=lstatSync(current);if(info.isSymbolicLink())throw new Error('Data path symlink rejected');if(current===path&&info.isFile()&&info.nlink>1)throw new Error('Hard-linked data path rejected');}catch(error){if(error.code!=='ENOENT')throw error;}if(dirname(current)===current)break;}
 return path;
}
export class Store extends BusinessStore {
 constructor(filename,{now=Date.now}={}) {
  super({now});
  this.filename=safeDataPath(filename);this.now=now;const existed=existsSync(this.filename);mkdirSync(dirname(this.filename),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(this.filename,{timeout:5000,allowExtension:false});
  try{const revision=this.db.prepare('PRAGMA user_version').get().user_version;
   if(!existed&&revision===0&&schemaRows(this.db).length===0)this.db.exec(schema);
   else validateDatabase(this.db);
   this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');chmodSync(this.filename,0o600);
  }catch(error){this.db.close();throw error;}
 }
 run(sql,...args){return this.db.prepare(sql).run(...args);}
 get(sql,...args){return this.db.prepare(sql).get(...args);}
 all(sql,...args){return this.db.prepare(sql).all(...args);}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 close(){this.db.close();}
 backup(destination){const target=safeDataPath(destination);if(target===this.filename||existsSync(target))throw new Error('Backup destination must be new and separate');mkdirSync(dirname(target),{recursive:true,mode:0o700});this.db.prepare('VACUUM INTO ?').run(target);chmodSync(target,0o600);return {schemaVersion:2,integrity:this.get('PRAGMA integrity_check').integrity_check};}

}

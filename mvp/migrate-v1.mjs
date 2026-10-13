import {DatabaseSync} from 'node:sqlite';
import {readFileSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copySnapshot} from './snapshot.mjs';
import {validateDatabase} from './store.mjs';
const legacy=readFileSync(new URL('./schema-v1.sql',import.meta.url),'utf8');
const rows=db=>JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all().map(row=>({...row,sql:row.sql?.replace(/\s+/g,' ').trim()})));
const expected=(()=>{const db=new DatabaseSync(':memory:');try{db.exec(legacy);return rows(db);}finally{db.close();}})();
function validateV1(db){if(db.prepare('PRAGMA user_version').get().user_version!==1||rows(db)!==expected||db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Migration requires a complete, intact V1 database');}
export async function migrateV1(source,destination){const target=await copySnapshot(source,destination,validateV1),db=new DatabaseSync(target,{allowExtension:false});let closed=false;
 try{db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');db.exec(schema.slice(schema.indexOf('ALTER TABLE room_members')));
  // V1 timestamps cannot establish a same-millisecond join boundary. Preserve its archive, hide all pre-migration history.
  db.exec('UPDATE room_members SET visible_after_message_seq=(SELECT COALESCE(MAX(seq),0) FROM messages WHERE room_id=room_members.room_id),visible_after_history_seq=(SELECT COALESCE(MAX(seq),0) FROM history WHERE room_id=room_members.room_id); DELETE FROM sessions;');validateDatabase(db);db.exec('COMMIT;');return {schemaVersion:2,sourceUnchanged:true,sessionsRevoked:true,oldHistoryArchived:true};
 }catch(error){try{db.exec('ROLLBACK;');}catch{}db.close();closed=true;unlinkSync(target);throw error;}finally{if(!closed)db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2);if(!args.includes('--source')||!args.includes('--output'))throw new Error('Use --source <V1-copy> --output <new-V2-file>');console.log(JSON.stringify(await migrateV1(args[args.indexOf('--source')+1],args[args.indexOf('--output')+1])));}

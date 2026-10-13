import schema from '../mvp/schema.sql';
import {BusinessStore} from '../mvp/business.mjs';
import {fail,digest} from '../mvp/security.mjs';
export const TABLES=['users','auth_credentials','sessions','rooms','room_members','messages','message_receipts','proposals','promises','promise_attendees','approval_reviews','history','cf_invites','cf_outbox','cf_rate','cf_usage','cf_meta'];
export class CloudStore extends BusinessStore {
 constructor(ctx){super();this.ctx=ctx;this.sql=ctx.storage.sql;this.meter=null;
  ctx.storage.transactionSync(()=>{this.sql.exec('CREATE TABLE IF NOT EXISTS cf_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT');
   const rev=this.sql.exec("SELECT value FROM cf_meta WHERE key='schema'").toArray()[0];
   if(!rev){this.sql.exec(schema.replace(/PRAGMA[^;]+;/g,''));
    this.sql.exec(`CREATE TABLE cf_invites(id TEXT PRIMARY KEY,issuer_id TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL) STRICT;
     CREATE TABLE cf_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL) STRICT;
     CREATE TABLE cf_rate(key TEXT PRIMARY KEY,used INTEGER NOT NULL,until_ms INTEGER NOT NULL) STRICT;
     CREATE TABLE cf_usage(day TEXT PRIMARY KEY,requests INTEGER NOT NULL,reads INTEGER NOT NULL,writes INTEGER NOT NULL) STRICT;`);
    this.sql.exec("INSERT INTO cf_meta VALUES ('schema','cf-v1'),('epoch','1')");
   }else if(rev.value!=='cf-v1')throw new Error('Unsupported Cloudflare schema');
  });
 }
 exec(sql,args){const c=this.sql.exec(sql,...args),rows=c.toArray();if(this.meter){this.meter.reads+=c.rowsRead;this.meter.writes+=c.rowsWritten;}return rows;}
 run(sql,...args){this.exec(sql,args);return this.get('SELECT changes() AS changes,last_insert_rowid() AS lastInsertRowid');}
 get(sql,...args){return this.exec(sql,args)[0];}
 all(sql,...args){return this.exec(sql,args);}
 tx(fn){return this.ctx.storage.transactionSync(fn);}
 take(key,limit,windowMs=60000){const now=this.now();this.run('DELETE FROM cf_rate WHERE until_ms<=?',now);let b=this.get('SELECT * FROM cf_rate WHERE key=?',key);if(!b){if(this.get('SELECT COUNT(*) AS n FROM cf_rate').n>=1000)fail(429,'RATE_LIMIT','잠시 후 다시 시도해주세요.');this.run('INSERT INTO cf_rate VALUES (?,0,?)',key,now+windowMs);b={used:0};}if(b.used>=limit)fail(429,'RATE_LIMIT','요청이 많아요. 잠시 후 다시 시도해주세요.');this.run('UPDATE cf_rate SET used=used+1 WHERE key=?',key);}
 event(fn,{requests=80000,reads=4000000,writes=80000,blocked=false}={}){const day=new Date(this.now()).toISOString().slice(0,10);this.meter=null;
  if(blocked)fail(503,'FREE_QUOTA_PAUSED','무료 한도 보호를 위해 잠시 쉬고 있어요.');
  const use=this.get('SELECT * FROM cf_usage WHERE day=?',day)||{requests:0,reads:0,writes:0};
  if(use.requests>=requests||use.reads>=reads||use.writes>=writes)fail(503,'FREE_QUOTA_PAUSED','무료 한도 보호를 위해 잠시 쉬고 있어요.');
  return this.tx(()=>{this.meter={reads:0,writes:0};try{const result=fn();const met=this.meter;this.meter=null;
   if(use.reads+met.reads+10>reads||use.writes+met.writes+10>writes)fail(503,'FREE_QUOTA_PAUSED','무료 한도 보호를 위해 잠시 쉬고 있어요.');
   this.run('INSERT INTO cf_usage VALUES (?,?,?,?) ON CONFLICT(day) DO UPDATE SET requests=requests+1,reads=reads+excluded.reads,writes=writes+excluded.writes',day,1,met.reads+10,met.writes+10);return result;
  }finally{this.meter=null;}});
 }
 enqueue(){const payload={users:this.users(),invites:this.all('SELECT issuer_id,COUNT(*) AS issued FROM cf_invites GROUP BY issuer_id'),promises:this.all('SELECT id,room_id,host_id,status,version FROM promises ORDER BY id')};this.run('INSERT INTO cf_outbox(payload) VALUES (?)',JSON.stringify(payload));}
 invite(userId,id){return this.tx(()=>{const old=this.get('SELECT * FROM cf_invites WHERE id=?',id);if(old){if(old.issuer_id!==userId)fail(409,'IDEMPOTENCY_CONFLICT','초대 요청 ID가 다릅니다.');return old;}if(this.get('SELECT COUNT(*) AS n FROM cf_invites WHERE issuer_id=?',userId).n>=5)fail(409,'INVITE_LIMIT','가입 초대권은 5장입니다.');this.run('INSERT INTO cf_invites VALUES (?,?,?)',id,userId,this.now());return this.get('SELECT * FROM cf_invites WHERE id=?',id);});}
 exportSnapshot(){const data={format:'promise-box-cf-v1',createdAt:this.now(),tables:Object.fromEntries(TABLES.map(table=>[table,this.all('SELECT * FROM '+table)]))};return {...data,checksum:digest(JSON.stringify(data))};}
 restore(snapshot){if(snapshot?.format!=='promise-box-cf-v1'||!snapshot.tables||snapshot.checksum!==digest(JSON.stringify({format:snapshot.format,createdAt:snapshot.createdAt,tables:snapshot.tables}))||JSON.stringify(Object.keys(snapshot.tables).sort())!==JSON.stringify([...TABLES].sort()))fail(422,'INVALID_BACKUP','지원되는 백업만 복구합니다.');
  if(this.get('SELECT COUNT(*) AS n FROM users').n)fail(409,'RESTORE_TARGET_NOT_EMPTY','새로운 격리 저장소에만 복구합니다.');
  this.tx(()=>{for(const table of [...TABLES].reverse())this.run('DELETE FROM '+table);
   for(const table of TABLES){if(['sessions','approval_reviews','cf_outbox','cf_rate','cf_usage'].includes(table))continue;const columns=this.all('PRAGMA table_info('+table+')').map(r=>r.name);
    if(!Array.isArray(snapshot.tables[table]))fail(422,'INVALID_BACKUP','백업 테이블을 확인해주세요.');
    for(const row of snapshot.tables[table]){if(JSON.stringify(Object.keys(row).sort())!==JSON.stringify([...columns].sort()))fail(422,'INVALID_BACKUP','백업 열이 다릅니다.');this.run('INSERT INTO '+table+' ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')',...columns.map(c=>row[c]));}
   }
   if(this.all('PRAGMA foreign_key_check').length)fail(422,'INVALID_BACKUP','백업 참조가 잘못되었습니다.');
   this.run("UPDATE cf_meta SET value=CAST(value AS INTEGER)+1 WHERE key='epoch'");this.enqueue();
  });return {restored:true,sessionsRevoked:true};
 }
}

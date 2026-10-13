import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,lstatSync,existsSync,chmodSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {appointment,fail,text,uuid,version} from './security.mjs';
const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
export function safeDataPath(filename) {
 if(typeof filename!=='string'||!filename.trim()||filename===':memory:')throw new Error('An explicit isolated SQLite file is required');
 const path=resolve(filename), comparable=value=>process.platform==='win32'?value.toLowerCase():value;
 for(const sub of ['docs','public','mvp/client','harness','tests']){const blocked=comparable(resolve(repo,sub)),target=comparable(path);if(target===blocked||target.startsWith(blocked+sep))throw new Error('Data cannot be placed in source or publication directories');}
 for(let current=path;;current=dirname(current)){try{if(lstatSync(current).isSymbolicLink())throw new Error('Data path symlink rejected');}catch(error){if(error.code!=='ENOENT')throw error;}if(dirname(current)===current)break;}
 return path;
}
export class Store {
 constructor(filename,{now=Date.now}={}) {
  this.filename=safeDataPath(filename);this.now=now;mkdirSync(dirname(this.filename),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(this.filename,{timeout:5000,allowExtension:false});chmodSync(this.filename,0o600);
  this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  const revision=this.db.prepare('PRAGMA user_version').get().user_version;
  if(revision>1){this.db.close();throw new Error('Unsupported database schema; do not overwrite it');}
  this.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 }
 run(sql,...args){return this.db.prepare(sql).run(...args);}
 get(sql,...args){return this.db.prepare(sql).get(...args);}
 all(sql,...args){return this.db.prepare(sql).all(...args);}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 close(){this.db.close();}
 backup(destination){const target=safeDataPath(destination);if(target===this.filename||existsSync(target))throw new Error('Backup destination must be new and separate');mkdirSync(dirname(target),{recursive:true,mode:0o700});this.db.prepare('VACUUM INTO ?').run(target);chmodSync(target,0o600);return {schemaVersion:1,integrity:this.get('PRAGMA integrity_check').integrity_check};}
 user(id){return this.get('SELECT id,handle,nickname FROM users WHERE id=?',id);}
 users(){return this.all('SELECT id,nickname FROM users ORDER BY created_at,id');}
 credential(handle){return this.get('SELECT u.id,u.nickname,c.password_salt AS salt,c.password_hash FROM users u JOIN auth_credentials c ON c.user_id=u.id WHERE u.handle=?',handle);}
 addUser(handle,nickname,credentials){
  if(typeof handle!=='string'||!/^[a-z0-9-]{3,32}$/.test(handle))fail(422,'INVALID_HANDLE','로그인 이름 형식을 확인해주세요.');
  const id=randomUUID();return this.tx(()=>{this.run('INSERT INTO users VALUES (?,?,?,?)',id,handle,text(nickname,30,'닉네임'),this.now());this.run('INSERT INTO auth_credentials VALUES (?,?,?)',id,credentials.salt,credentials.hash);return this.user(id);});
 }
 addSession(hash,userId,{idleMs=900000,absoluteMs=28800000}={}) {
  const now=this.now();this.run('DELETE FROM sessions WHERE expires_at<=? OR last_seen<=?',now,now-idleMs);
  this.run('INSERT INTO sessions VALUES (?,?,?,?,?)',hash,userId,now,now,now+absoluteMs);
  const old=this.all('SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC,token_hash LIMIT -1 OFFSET 5',userId);
  for(const item of old)this.run('DELETE FROM sessions WHERE token_hash=?',item.token_hash);
  return old.map(item=>item.token_hash);
 }
 session(hash,{idleMs=900000,touch=true}={}) {
  const row=this.get('SELECT * FROM sessions WHERE token_hash=?',hash),now=this.now();
  if(!row||row.expires_at<=now||row.last_seen+idleMs<=now){if(row)this.run('DELETE FROM sessions WHERE token_hash=?',hash);return null;}
  if(touch)this.run('UPDATE sessions SET last_seen=? WHERE token_hash=?',now,hash);
  return {user:this.user(row.user_id),hash,expiresAt:row.expires_at};
 }
 dropSession(hash){this.run('DELETE FROM sessions WHERE token_hash=?',hash);}
 member(roomId,userId){return this.get('SELECT r.* FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE r.id=? AND m.user_id=? AND m.active=1',roomId,userId);}
 requireMember(roomId,userId){const room=this.member(roomId,userId);if(!room)fail(403,'ROOM_FORBIDDEN','이 방에 접근할 권한이 없습니다.');return room;}
 owner(roomId,userId){const room=this.requireMember(roomId,userId);if(room.owner_id!==userId)fail(403,'OWNER_REQUIRED','그룹 주최자만 참가자를 관리할 수 있습니다.');return room;}
 members(roomId){return this.all('SELECT u.id,u.nickname FROM users u JOIN room_members m ON u.id=m.user_id WHERE m.room_id=? AND m.active=1 ORDER BY m.joined_at,u.id',roomId);}
 rooms(userId){return this.all('SELECT r.* FROM rooms r JOIN room_members m ON r.id=m.room_id WHERE m.user_id=? AND m.active=1 ORDER BY r.created_at DESC',userId).map(room=>({...room,members:this.members(room.id)}));}
 createRoom(userId,{kind,title,memberIds}) {
  if(!['direct','group'].includes(kind)||!Array.isArray(memberIds)||memberIds.length<1||memberIds.length>19)fail(422,'INVALID_ROOM','참가자를 선택해주세요.');
  const ids=[userId,...memberIds.map(uuid)];if(new Set(ids).size!==ids.length||(kind==='direct'&&ids.length!==2))fail(422,'INVALID_MEMBERS','서로 다른 참가자를 선택해주세요.');
  if(ids.some(id=>!this.user(id)))fail(422,'INVALID_MEMBERS','등록된 합성 사용자만 참가할 수 있습니다.');
  const name=text(title,80,'방 이름'),key=kind==='direct'?[...ids].sort().join(':'):null;
  return this.tx(()=>{
   if(key){const existing=this.get('SELECT * FROM rooms WHERE direct_key=?',key);if(existing)return existing;}
   const roomId=randomUUID(),now=this.now();this.run('INSERT INTO rooms VALUES (?,?,?,?,?,?)',roomId,kind,name,userId,key,now);
   for(const id of ids)this.run('INSERT INTO room_members VALUES (?,?,1,?)',roomId,id,now);
   this.record(roomId,null,userId,'room.created',{kind,memberIds:ids});return this.get('SELECT * FROM rooms WHERE id=?',roomId);
  });
 }
 manageMember(roomId,actorId,userId,active){
  uuid(userId);const room=this.owner(roomId,actorId);if(room.kind!=='group'||userId===room.owner_id)fail(409,'MEMBERSHIP_LOCKED','주최자 또는 1:1 방 참가자는 변경할 수 없습니다.');
  if(!this.user(userId))fail(422,'INVALID_MEMBER','등록된 사용자만 초대할 수 있습니다.');
  return this.tx(()=>{this.owner(roomId,actorId);if(active&&this.members(roomId).length>=20&&!this.member(roomId,userId))fail(409,'GROUP_FULL','그룹은 최대 20명입니다.');
   this.run('INSERT INTO room_members VALUES (?,?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET active=excluded.active,joined_at=excluded.joined_at',roomId,userId,active?1:0,this.now());
   this.record(roomId,null,actorId,active?'member.added':'member.removed',{userId});return this.members(roomId);});
 }
 record(roomId,promiseId,actorId,kind,payload){this.run('INSERT INTO history(room_id,promise_id,actor_id,kind,payload,created_at) VALUES (?,?,?,?,?,?)',roomId,promiseId,actorId,kind,JSON.stringify(payload),this.now());}
 messageView(row){return {...row,sender:this.user(row.sender_id),receipts:this.all('SELECT user_id,delivered_at FROM message_receipts WHERE message_id=?',row.id)};}
 messages(roomId,userId,{after=0}={}){this.requireMember(roomId,userId);if(!Number.isSafeInteger(after)||after<0)fail(422,'INVALID_CURSOR','메시지 위치를 확인해주세요.');return this.all('SELECT * FROM messages WHERE room_id=? AND seq>? ORDER BY seq LIMIT 200',roomId,after).map(row=>this.messageView(row));}
 send(roomId,userId,clientId,body){uuid(clientId);const value=text(body,2000,'메시지');return this.tx(()=>{
  this.requireMember(roomId,userId);const old=this.get('SELECT * FROM messages WHERE room_id=? AND sender_id=? AND client_id=?',roomId,userId,clientId);
  if(old){if(old.body!==value)fail(409,'IDEMPOTENCY_CONFLICT','같은 전송 ID의 내용이 다릅니다.');return {message:this.messageView(old),duplicate:true};}
  const id=randomUUID();this.run('INSERT INTO messages(id,room_id,sender_id,client_id,body,created_at) VALUES (?,?,?,?,?,?)',id,roomId,userId,clientId,value,this.now());
  for(const member of this.members(roomId))if(member.id!==userId)this.run('INSERT INTO message_receipts VALUES (?,?,NULL)',id,member.id);
  return {message:this.messageView(this.get('SELECT * FROM messages WHERE id=?',id)),duplicate:false};
 });}
 receive(roomId,userId,messageIds){if(!Array.isArray(messageIds)||messageIds.length>200||new Set(messageIds).size!==messageIds.length)fail(422,'INVALID_RECEIPTS','수신 확인 목록을 확인해주세요.');return this.tx(()=>{
  this.requireMember(roomId,userId);let changed=0;for(const id of messageIds){uuid(id);const message=this.get('SELECT * FROM messages WHERE id=? AND room_id=?',id,roomId);if(!message)fail(403,'RECEIPT_FORBIDDEN','다른 방의 메시지는 확인할 수 없습니다.');changed+=Number(this.run('UPDATE message_receipts SET delivered_at=? WHERE message_id=? AND user_id=? AND delivered_at IS NULL',this.now(),id,userId).changes);}return {received:true,changed};
 });}
 proposalView(row){return {...row,payload:JSON.parse(row.payload),synthetic:true};}
 proposal(id,userId){const row=this.get('SELECT * FROM proposals WHERE id=?',id);if(!row)fail(404,'NOT_FOUND','후보를 찾을 수 없습니다.');this.requireMember(row.room_id,userId);return row;}
 propose(roomId,userId,payload){const valid=appointment(payload),id=randomUUID();return this.tx(()=>{this.requireMember(roomId,userId);this.run('INSERT INTO proposals VALUES (?,?,?, ?,\'pending\',1,?)',id,roomId,userId,JSON.stringify(valid),this.now());return this.proposalView(this.proposal(id,userId));});}
 editProposal(id,userId,expected,payload){const valid=appointment(payload);return this.tx(()=>{const row=this.proposal(id,userId);this.host(row,userId);this.matchVersion(row,expected);if(row.status!=='pending')fail(409,'NOT_PENDING','미확정 후보만 수정할 수 있습니다.');this.run('UPDATE proposals SET payload=?,version=version+1 WHERE id=?',JSON.stringify(valid),id);return this.proposalView(this.proposal(id,userId));});}
 ignoreProposal(id,userId,expected){return this.tx(()=>{const row=this.proposal(id,userId);this.host(row,userId);this.matchVersion(row,expected);if(row.status!=='pending')fail(409,'NOT_PENDING','이미 선택한 후보입니다.');this.run('UPDATE proposals SET status=\'ignored\',version=version+1 WHERE id=?',id);return this.proposalView(this.proposal(id,userId));});}
 host(row,userId){if(row.host_id!==userId)fail(403,'HOST_REQUIRED','약속 주최자만 확정·수정·취소할 수 있습니다.');}
 matchVersion(row,expected){version(expected);if(row.version!==expected)fail(409,'STALE_VERSION','내용이 바뀌었습니다. 최신 내용을 다시 확인해주세요.');}
 confirm(id,userId,expected,decision){if(decision!=='CONFIRM')fail(422,'EXPLICIT_CONFIRMATION_REQUIRED','명시적 확정 선택이 필요합니다.');version(expected);return this.tx(()=>{
  const row=this.proposal(id,userId);this.host(row,userId);
  if(row.status==='confirmed'){const promise=this.get('SELECT * FROM promises WHERE proposal_id=?',id);if(promise.proposal_version!==expected)fail(409,'STALE_VERSION','확인한 버전이 다릅니다.');return this.promiseView(promise);}
  this.matchVersion(row,expected);if(row.status!=='pending')fail(409,'NOT_PENDING','미확정 후보만 확정할 수 있습니다.');
  const promiseId=randomUUID(),now=this.now();this.run('INSERT INTO promises VALUES (?,?,?,?,?,?,\'confirmed\',1,?,?)',promiseId,id,expected,row.room_id,userId,row.payload,now,now);
  for(const member of this.members(row.room_id))this.run('INSERT INTO promise_attendees VALUES (?,?,\'pending\',NULL)',promiseId,member.id);
  this.run('UPDATE proposals SET status=\'confirmed\',version=version+1 WHERE id=?',id);
  this.record(row.room_id,promiseId,userId,'promise.confirmed',{proposalId:id,payload:JSON.parse(row.payload)});return this.promiseView(this.get('SELECT * FROM promises WHERE id=?',promiseId));
 });}
 promise(id,userId){const row=this.get('SELECT * FROM promises WHERE id=?',id);if(!row)fail(404,'NOT_FOUND','약속을 찾을 수 없습니다.');this.requireMember(row.room_id,userId);return row;}
 promiseView(row){return {...row,payload:JSON.parse(row.payload),attendees:this.all('SELECT a.*,u.nickname,m.active AS room_member_active FROM promise_attendees a JOIN users u ON a.user_id=u.id LEFT JOIN room_members m ON m.room_id=? AND m.user_id=a.user_id WHERE a.promise_id=?',row.room_id,row.id),history:this.all('SELECT * FROM history WHERE promise_id=? ORDER BY seq',row.id).map(item=>({...item,payload:JSON.parse(item.payload)}))};}
 promises(userId){return this.all('SELECT p.* FROM promises p JOIN room_members m ON p.room_id=m.room_id WHERE m.user_id=? AND m.active=1 ORDER BY p.created_at DESC',userId).map(row=>this.promiseView(row));}
 rsvp(id,userId,response){if(!['going','maybe','declined'].includes(response))fail(422,'INVALID_RSVP','참석 상태를 확인해주세요.');return this.tx(()=>{const row=this.promise(id,userId);if(row.status!=='confirmed')fail(409,'CANCELLED','취소된 약속에는 응답할 수 없습니다.');if(!this.get('SELECT * FROM promise_attendees WHERE promise_id=? AND user_id=?',id,userId))fail(403,'ATTENDEE_REQUIRED','확정 시 참가자만 응답할 수 있습니다.');this.run('UPDATE promise_attendees SET response=?,responded_at=? WHERE promise_id=? AND user_id=?',response,this.now(),id,userId);this.record(row.room_id,id,userId,'rsvp.changed',{response});return this.promiseView(this.promise(id,userId));});}
 review(id,userId,kind,expected,payload){if(!['change','cancel'].includes(kind))fail(422,'INVALID_ACTION','확인 종류를 선택해주세요.');const valid=kind==='change'?appointment(payload):null;return this.tx(()=>{
  const row=this.promise(id,userId);this.host(row,userId);this.matchVersion(row,expected);if(row.status!=='confirmed')fail(409,'CANCELLED','이미 취소된 약속입니다.');const reviewId=randomUUID(),expiresAt=this.now()+300000;this.run('INSERT INTO approval_reviews VALUES (?,?,?,?,?,?,?,NULL)',reviewId,id,userId,kind,expected,valid?JSON.stringify(valid):null,expiresAt);
  return {reviewId,kind,expectedVersion:expected,before:JSON.parse(row.payload),after:valid,expiresAt,question:kind==='change'?'이 내용으로 변경할까요?':'약속을 취소할까요?'};
 });}
 apply(id,userId,reviewId,decision){if(decision!=='CONFIRM')fail(422,'EXPLICIT_CONFIRMATION_REQUIRED','명시적 승인 선택이 필요합니다.');uuid(reviewId);return this.tx(()=>{
  const row=this.promise(id,userId);this.host(row,userId);const review=this.get('SELECT * FROM approval_reviews WHERE id=? AND promise_id=? AND actor_id=?',reviewId,id,userId);if(!review)fail(403,'REVIEW_FORBIDDEN','본인이 확인한 변경만 승인할 수 있습니다.');if(review.used_at!==null||review.expires_at<=this.now())fail(409,'REVIEW_EXPIRED','확인 요청을 다시 만들어주세요.');this.matchVersion(row,review.expected_version);if(row.status!=='confirmed')fail(409,'CANCELLED','이미 취소된 약속입니다.');
  if(review.kind==='change'){const previous=this.promiseView(row);this.run('UPDATE promises SET payload=?,version=version+1,updated_at=? WHERE id=?',review.payload,this.now(),id);this.run('UPDATE promise_attendees SET response=\'pending\',responded_at=NULL WHERE promise_id=?',id);this.record(row.room_id,id,userId,'promise.changed',{before:JSON.parse(row.payload),after:JSON.parse(review.payload),previousResponses:previous.attendees.map(item=>({userId:item.user_id,response:item.response}))});}
  else{this.run('UPDATE promises SET status=\'cancelled\',version=version+1,updated_at=? WHERE id=?',this.now(),id);this.record(row.room_id,id,userId,'promise.cancelled',{payload:JSON.parse(row.payload)});}
  this.run('UPDATE approval_reviews SET used_at=? WHERE id=?',this.now(),reviewId);return this.promiseView(this.promise(id,userId));
 });}
 snapshot(roomId,userId){const room=this.requireMember(roomId,userId);return {room:{...room,members:this.members(roomId)},messages:this.messages(roomId,userId),proposals:this.all('SELECT * FROM proposals WHERE room_id=? ORDER BY created_at',roomId).map(row=>this.proposalView(row)),promises:this.all('SELECT * FROM promises WHERE room_id=? ORDER BY created_at',roomId).map(row=>this.promiseView(row))};}
}

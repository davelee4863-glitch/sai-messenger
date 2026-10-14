import {randomUUID} from 'node:crypto';
import {BusinessStore} from '../mvp/business.mjs';
import {fail,text,uuid,version} from '../mvp/security.mjs';

// All approval decisions live in the same DO transaction as the authoritative
// proposal/promise. D1 is never consulted for membership, versions or consent.
export const CONSENT_TABLES=['cf_proposal_rounds','cf_proposal_consents','cf_promise_changes','cf_change_consents','cf_promise_consents'];
export const CONSENT_SCHEMA=`
 CREATE TABLE IF NOT EXISTS cf_proposal_rounds(proposal_id TEXT PRIMARY KEY REFERENCES proposals(id),version INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('awaiting','negotiating','confirmed','ignored'))) STRICT;
 CREATE TABLE IF NOT EXISTS cf_proposal_consents(proposal_id TEXT NOT NULL REFERENCES proposals(id),version INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),confirmed_at INTEGER NOT NULL,PRIMARY KEY(proposal_id,version,user_id)) STRICT;
 CREATE TABLE IF NOT EXISTS cf_promise_changes(id TEXT PRIMARY KEY,promise_id TEXT NOT NULL REFERENCES promises(id),base_version INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),state TEXT NOT NULL CHECK(state IN ('awaiting','negotiating','applied','superseded','cancelled')),created_at INTEGER NOT NULL) STRICT;
 CREATE UNIQUE INDEX IF NOT EXISTS cf_one_active_change ON cf_promise_changes(promise_id) WHERE state IN ('awaiting','negotiating');
 CREATE TABLE IF NOT EXISTS cf_change_consents(change_id TEXT NOT NULL REFERENCES cf_promise_changes(id),revision INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),confirmed_at INTEGER NOT NULL,PRIMARY KEY(change_id,revision,user_id)) STRICT;
 CREATE TABLE IF NOT EXISTS cf_promise_consents(promise_id TEXT NOT NULL REFERENCES promises(id),version INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),confirmed_at INTEGER NOT NULL,PRIMARY KEY(promise_id,version,user_id)) STRICT;
`;

export class ConsentStore extends BusinessStore {
 isDirect(row){return this.get('SELECT kind FROM rooms WHERE id=?',row.room_id)?.kind==='direct';}
 directParticipants(row){const members=this.members(row.room_id);if(members.length!==2||!members.some(m=>m.id===row.host_id))fail(409,'CONSENT_MEMBERS_INVALID','두 사람의 참가 권한을 다시 확인해주세요.');return members;}
 approvals(table,column,id,revision,revisionColumn='version'){
  return this.all(`SELECT c.user_id,c.confirmed_at,u.nickname FROM ${table} c JOIN users u ON u.id=c.user_id WHERE c.${column}=? AND c.${revisionColumn}=? ORDER BY c.user_id`,id,revision);
 }
 both(row,approvals){const ids=this.directParticipants(row).map(m=>m.id);return approvals.length===2&&ids.every(id=>approvals.some(a=>a.user_id===id));}
 ensureRound(row){this.run("INSERT OR IGNORE INTO cf_proposal_rounds VALUES (?,?,'awaiting')",row.id,row.version);return this.get('SELECT * FROM cf_proposal_rounds WHERE proposal_id=?',row.id);}
 proposalView(row){const view=super.proposalView(row);if(!this.isDirect(row))return {...view,confirmationMode:'host'};
  const promise=row.status==='confirmed'?this.get('SELECT * FROM promises WHERE proposal_id=?',row.id):null;
  const currentVersion=promise?.proposal_version??row.version,approvals=this.approvals('cf_proposal_consents','proposal_id',row.id,currentVersion),round=this.get('SELECT * FROM cf_proposal_rounds WHERE proposal_id=?',row.id);
  const state=row.status==='ignored'?'ignored':row.status==='confirmed'?(this.both(row,approvals)?'mutually_confirmed':'legacy_unverified'):round?.state==='negotiating'?'negotiating':'awaiting';
  return {...view,confirmationMode:'mutual',confirmation:{state,version:currentVersion,participants:this.directParticipants(row),approvals}};
 }
 propose(roomId,userId,payload){return this.tx(()=>{const proposal=super.propose(roomId,userId,payload);if(this.isDirect(proposal))this.ensureRound(proposal);return this.proposalView(this.proposal(proposal.id,userId));});}
 editProposal(id,userId,expected,payload){return this.tx(()=>{const before=this.proposal(id,userId),result=super.editProposal(id,userId,expected,payload);if(this.isDirect(before)){
   this.run("INSERT INTO cf_proposal_rounds VALUES (?,?,'awaiting') ON CONFLICT(proposal_id) DO UPDATE SET version=excluded.version,state=excluded.state",id,result.version);
   this.record(before.room_id,null,userId,'proposal.revised',{proposalId:id,previousVersion:before.version,version:result.version,before:JSON.parse(before.payload),after:result.payload});
  }return this.proposalView(this.proposal(id,userId));});}
 ignoreProposal(id,userId,expected){return this.tx(()=>{const result=super.ignoreProposal(id,userId,expected);if(this.isDirect(result)){this.run("UPDATE cf_proposal_rounds SET state='ignored' WHERE proposal_id=?",id);this.record(result.room_id,null,userId,'proposal.ignored',{proposalId:id,version:expected});}return this.proposalView(this.proposal(id,userId));});}
 requestProposalChange(id,userId,expected,note='일정을 다시 맞춰요.') {const message=text(note,500,'변경 요청');return this.tx(()=>{
  const row=this.proposal(id,userId);if(!this.isDirect(row))fail(403,'DIRECT_ONLY','1:1 상호 확인에서만 사용합니다.');this.directParticipants(row);this.matchVersion(row,expected);if(row.status!=='pending')fail(409,'NOT_PENDING','미확정 후보에서 변경을 요청해주세요.');
  this.run('UPDATE proposals SET version=version+1 WHERE id=?',id);this.run("INSERT INTO cf_proposal_rounds VALUES (?,?,'negotiating') ON CONFLICT(proposal_id) DO UPDATE SET version=excluded.version,state=excluded.state",id,row.version+1);
  this.record(row.room_id,null,userId,'proposal.change_requested',{proposalId:id,previousVersion:row.version,version:row.version+1,note:message});return this.proposalView(this.proposal(id,userId));
 });}
 confirmProposal(id,userId,expected,decision){if(decision!=='CONFIRM')fail(422,'EXPLICIT_CONFIRMATION_REQUIRED','명시적 확정 선택이 필요합니다.');version(expected);return this.tx(()=>{
  const row=this.proposal(id,userId);if(!this.isDirect(row))return {promise:super.confirm(id,userId,expected,decision),proposal:this.proposalView(this.proposal(id,userId))};
  this.directParticipants(row);
  if(row.status==='confirmed'){const promise=this.get('SELECT * FROM promises WHERE proposal_id=?',id);if(promise.proposal_version!==expected)fail(409,'STALE_VERSION','확인한 버전이 다릅니다.');if(!this.both(row,this.approvals('cf_proposal_consents','proposal_id',id,expected)))fail(409,'CONSENT_UNVERIFIED','이전 약속은 새로운 후보로 함께 확인해주세요.');return {promise:this.promiseView(promise,userId),proposal:this.proposalView(row)};}
  this.matchVersion(row,expected);if(row.status!=='pending')fail(409,'NOT_PENDING','미확정 후보만 확인할 수 있습니다.');if(this.ensureRound(row).state==='negotiating')fail(409,'CHANGES_PENDING','후보 내용을 수정한 뒤 다시 함께 확인해주세요.');
  if(!this.get('SELECT 1 FROM cf_proposal_consents WHERE proposal_id=? AND version=? AND user_id=?',id,expected,userId)){
   this.run('INSERT INTO cf_proposal_consents VALUES (?,?,?,?)',id,expected,userId,this.now());this.record(row.room_id,null,userId,'proposal.approved',{proposalId:id,version:expected});
  }
  const approvals=this.approvals('cf_proposal_consents','proposal_id',id,expected);let promise=null;
  if(this.both(row,approvals)){
   const pid=randomUUID(),now=this.now();this.run("INSERT INTO promises VALUES (?,?,?,?,?,?,'confirmed',1,?,?,?)",pid,id,expected,row.room_id,row.host_id,row.payload,now,now,row.visibility_seq);
   for(const member of this.directParticipants(row))this.run("INSERT INTO promise_attendees VALUES (?,?,'pending',NULL)",pid,member.id);
   for(const approval of approvals)this.run('INSERT INTO cf_promise_consents VALUES (?,1,?,?)',pid,approval.user_id,approval.confirmed_at);
   this.run("UPDATE proposals SET status='confirmed',version=version+1 WHERE id=?",id);this.run("UPDATE cf_proposal_rounds SET state='confirmed' WHERE proposal_id=?",id);
   this.record(row.room_id,pid,userId,'promise.confirmed',{proposalId:id,proposalVersion:expected,participantIds:approvals.map(a=>a.user_id),payload:JSON.parse(row.payload)});promise=this.promiseView(this.promise(pid,userId),userId);
  }
  return {promise,proposal:this.proposalView(this.proposal(id,userId))};
 });}
 activeChange(id){return this.get("SELECT * FROM cf_promise_changes WHERE promise_id=? AND state IN ('awaiting','negotiating')",id);}
 promiseConfirmation(row){const approvals=this.approvals('cf_promise_consents','promise_id',row.id,row.version),change=this.activeChange(row.id);return {state:row.status==='cancelled'?'cancelled':change?change.state:this.both(row,approvals)?'mutually_confirmed':'legacy_unverified',version:row.version,participants:this.directParticipants(row),approvals};}
 effectiveStatus(row){if(!this.isDirect(row)||row.status==='cancelled')return row.status;const state=this.promiseConfirmation(row).state;return state==='mutually_confirmed'?'confirmed':state==='negotiating'?'negotiating':'awaiting_confirmation';}
 promiseView(row,userId){const view=super.promiseView(row,userId);if(!this.isDirect(row))return {...view,confirmationMode:'host'};const change=this.activeChange(row.id);return {...view,status:this.effectiveStatus(row),confirmationMode:'mutual',confirmation:this.promiseConfirmation(row),pendingChange:change?{id:change.id,baseVersion:change.base_version,revision:change.revision,state:change.state,payload:JSON.parse(change.payload),approvals:this.approvals('cf_change_consents','change_id',change.id,change.revision,'revision')}:null};}
 rsvp(id,userId,response,expected){if(!['going','maybe','declined'].includes(response))fail(422,'INVALID_RSVP','참석 상태를 확인해주세요.');return this.tx(()=>{const row=this.promise(id,userId);this.matchVersion(row,expected);if(this.isDirect(row)&&this.effectiveStatus(row)!=='confirmed')fail(409,'CONSENT_PENDING','상호 확인이 끝난 뒤 응답해주세요.');const previous=this.get('SELECT response FROM promise_attendees WHERE promise_id=? AND user_id=?',id,userId);if(previous?.response===response&&row.status==='confirmed')return this.promiseView(row,userId);return super.rsvp(id,userId,response);});}
 apply(id,userId,reviewId,decision){return this.tx(()=>{
  const row=this.promise(id,userId);if(!this.isDirect(row))return super.apply(id,userId,reviewId,decision);
  if(decision!=='CONFIRM')fail(422,'EXPLICIT_CONFIRMATION_REQUIRED','명시적 승인 선택이 필요합니다.');uuid(reviewId);this.host(row,userId);
  const review=this.get('SELECT * FROM approval_reviews WHERE id=? AND promise_id=? AND actor_id=?',reviewId,id,userId);if(!review)fail(403,'REVIEW_FORBIDDEN','본인이 확인한 변경만 승인할 수 있습니다.');if(review.used_at!==null||review.expires_at<=this.now())fail(409,'REVIEW_EXPIRED','확인 요청을 다시 만들어주세요.');this.matchVersion(row,review.expected_version);if(row.status!=='confirmed')fail(409,'CANCELLED','이미 취소된 약속입니다.');
  if(review.kind==='cancel'){this.run("UPDATE cf_promise_changes SET state='cancelled' WHERE promise_id=? AND state IN ('awaiting','negotiating')",id);return super.apply(id,userId,reviewId,decision);}
  this.run("UPDATE cf_promise_changes SET state='superseded' WHERE promise_id=? AND state IN ('awaiting','negotiating')",id);
  this.run("INSERT INTO cf_promise_changes VALUES (?,?,?,1,?,?,'awaiting',?)",reviewId,id,row.version,review.payload,userId,this.now());this.run('INSERT INTO cf_change_consents VALUES (?,1,?,?)',reviewId,userId,this.now());this.run('UPDATE approval_reviews SET used_at=? WHERE id=?',this.now(),reviewId);
  this.record(row.room_id,id,userId,'promise.change_requested',{changeId:reviewId,baseVersion:row.version,before:JSON.parse(row.payload),after:JSON.parse(review.payload)});return this.promiseView(this.promise(id,userId),userId);
 });}
 requireChange(row,changeId,expected,revision){uuid(changeId);version(expected);version(revision);const change=this.get('SELECT * FROM cf_promise_changes WHERE id=? AND promise_id=?',changeId,row.id);if(!this.isDirect(row)||!change)fail(403,'CHANGE_FORBIDDEN','이 약속의 상호 변경 요청만 확인해주세요.');if(change.revision!==revision||change.base_version!==expected)fail(409,'STALE_VERSION','변경 내용을 다시 확인해주세요.');this.directParticipants(row);return change;}
 confirmChange(id,userId,changeId,expected,revision,decision){if(decision!=='CONFIRM')fail(422,'EXPLICIT_CONFIRMATION_REQUIRED','명시적 확정 선택이 필요합니다.');return this.tx(()=>{
  const row=this.promise(id,userId),change=this.requireChange(row,changeId,expected,revision);
  if(change.state==='applied'&&row.status==='confirmed'&&row.version===expected+1)return this.promiseView(row,userId);
  this.matchVersion(row,expected);if(row.status!=='confirmed'||change.state!=='awaiting')fail(409,'CHANGE_NOT_PENDING','현재 변경 내용을 먼저 조율해주세요.');
  if(!this.get('SELECT 1 FROM cf_change_consents WHERE change_id=? AND revision=? AND user_id=?',changeId,revision,userId)){this.run('INSERT INTO cf_change_consents VALUES (?,?,?,?)',changeId,revision,userId,this.now());this.record(row.room_id,id,userId,'promise.change_approved',{changeId,revision,baseVersion:expected});}
  const approvals=this.approvals('cf_change_consents','change_id',changeId,revision,'revision');if(this.both(row,approvals)){
   const previous=this.promiseView(row,userId);this.run('UPDATE promises SET payload=?,version=version+1,updated_at=? WHERE id=?',change.payload,this.now(),id);this.run("UPDATE promise_attendees SET response='pending',responded_at=NULL WHERE promise_id=?",id);
   for(const approval of approvals)this.run('INSERT INTO cf_promise_consents VALUES (?,?,?,?)',id,expected+1,approval.user_id,approval.confirmed_at);
   this.run("UPDATE cf_promise_changes SET state='applied' WHERE id=?",changeId);this.record(row.room_id,id,userId,'promise.changed',{changeId,before:JSON.parse(row.payload),after:JSON.parse(change.payload),version:expected+1,participantIds:approvals.map(a=>a.user_id),previousResponses:previous.attendees.map(a=>({userId:a.user_id,response:a.response}))});
  }return this.promiseView(this.promise(id,userId),userId);
 });}
 requestChangeNegotiation(id,userId,changeId,expected,revision,note='일정을 다시 맞춰요.'){const message=text(note,500,'변경 요청');return this.tx(()=>{const row=this.promise(id,userId),change=this.requireChange(row,changeId,expected,revision);this.matchVersion(row,expected);if(row.status!=='confirmed'||change.state!=='awaiting')fail(409,'CHANGE_NOT_PENDING','현재 변경 요청에서만 조율할 수 있습니다.');this.run("UPDATE cf_promise_changes SET state='negotiating',revision=revision+1 WHERE id=?",changeId);this.record(row.room_id,id,userId,'promise.change_negotiation_requested',{changeId,revision:revision+1,note:message});return this.promiseView(this.promise(id,userId),userId);});}
}

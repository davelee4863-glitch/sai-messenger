// Synthetic, in-memory UI demonstration. This module has no I/O or persistence.
export const viewerId = 'me';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export const people = freeze({
  me: { name: '나', initial: '나', role: '주최자' },
  minseo: { name: '민서', initial: '민' },
  hajun: { name: '하준', initial: '하' },
  yujin: { name: '유진', initial: '유' },
});

export const rooms = freeze([
  { id: 'direct-minseo', title: '민서', kind: 'direct', participantIds: ['me', 'minseo'], preview: '토요일에 같이 커피 마실까?', when: '13:42', unread: 2, emoji: '☕' },
  { id: 'group-weekend', title: '우리의 주말', kind: 'group', participantIds: ['me', 'minseo', 'hajun', 'yujin'], preview: '이번 주말, 서울숲에서 만나요.', when: '13:30', unread: 1, emoji: '🌷' },
  { id: 'direct-yujin', title: '유진', kind: 'direct', participantIds: ['me', 'yujin'], preview: '다음 주 전시 보러 가자!', when: '어제', unread: 0, emoji: '🎨' },
]);

const roomIds = new Set(rooms.map(room => room.id));
const editableFields = new Set(['title', 'date', 'time', 'endTime', 'place', 'notes']);
const rsvpStatuses = new Set(['pending', 'going', 'maybe', 'declined']);

function clone(state) { return structuredClone(state); }
function done(state) { return freeze(state); }
function roomExists(id) {
  if (!roomIds.has(id)) throw new Error('채팅방을 찾을 수 없어요.');
}
function textValue(value, name, { empty = false, max = 2000 } = {}) {
  if (typeof value !== 'string') throw new Error(`${name}을 올바르게 입력해 주세요.`);
  if (!empty && !value.trim()) throw new Error(`${name}을 입력해 주세요.`);
  if (value.length > max) throw new Error(`${name}은 ${max}자까지 입력할 수 있어요.`);
  return value;
}
function validateDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('날짜는 YYYY-MM-DD 형식으로 입력해 주세요.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('실제로 존재하는 날짜를 선택해 주세요.');
}
function validateTime(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('시간은 올바른 24시간 형식으로 입력해 주세요.');
}
function validateAppointment(value) {
  textValue(value.title, '약속 이름', { max: 80 });
  textValue(value.place, '장소', { max: 200 });
  textValue(value.notes, '메모', { empty: true });
  validateDate(value.date);
  validateTime(value.time);
  validateTime(value.endTime);
  if (value.endTime <= value.time) throw new Error('종료 시간은 시작 시간보다 늦어야 해요.');
}
function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('변경할 약속 정보를 확인해 주세요.');
  if (Object.keys(patch).some(key => !editableFields.has(key))) throw new Error('주최자, 참석자, 확정 상태는 여기서 변경할 수 없어요.');
}
function proposalFor(state, roomId) {
  roomExists(roomId);
  const proposal = state.proposalsByRoom[roomId];
  if (!proposal) throw new Error('이 채팅방에는 약속 후보가 없어요.');
  return proposal;
}
function promiseFor(state, promiseId) {
  const promise = state.promises.find(item => item.id === promiseId);
  if (!promise) throw new Error('약속을 찾을 수 없어요.');
  return promise;
}
function history(type, text, sequence) {
  return { type, text, at: '데모 세션', sequence };
}

export function createDemoState() {
  const proposalsByRoom = {
    'direct-minseo': { id: 'coffee-saturday', roomId: 'direct-minseo', title: '토요일의 커피 한 잔', date: '2026-10-17', time: '14:00', endTime: '15:00', place: '카페 살구 · 성수', notes: '창가 자리에서 천천히 이야기해요.', hostId: viewerId, participantIds: ['me', 'minseo'], status: 'pending' },
    'group-weekend': { id: 'weekend-picnic', roomId: 'group-weekend', title: '우리의 가을 피크닉', date: '2026-10-17', time: '16:00', endTime: '18:00', place: '서울숲 · 3번 출입구', notes: '돗자리와 좋아하는 간식을 가져와요.', hostId: viewerId, participantIds: ['me', 'minseo', 'hajun', 'yujin'], status: 'pending' },
    'direct-yujin': { id: 'gallery-friday', roomId: 'direct-yujin', title: '작은 전시 산책', date: '2026-10-23', time: '15:00', endTime: '16:30', place: '갤러리 봄 · 합성 장소', notes: '전시 후에는 근처에서 차를 마셔요.', hostId: viewerId, participantIds: ['me', 'yujin'], status: 'pending' },
  };
  for(const item of Object.values(proposalsByRoom)){item.version=1;item.approvals={};item.phase='awaiting';item.history=[];}
  return done({
    activeRoomId: 'direct-minseo',
    draftsByRoom: Object.fromEntries(rooms.map(room => [room.id, ''])),
    messagesByRoom: {
      'direct-minseo': [
        { id: 'message-1', senderId: 'minseo', text: '이번 주 토요일에 시간 있어?', time: '13:40', kind: 'text' },
        { id: 'message-2', senderId: viewerId, text: '좋아! 성수에서 오후 2시에 어때?', time: '13:41', kind: 'text' },
        { id: 'message-3', senderId: 'minseo', text: '카페 살구에서 만나자. 기대된다 :)', time: '13:42', kind: 'text' },
      ],
      'group-weekend': [
        { id: 'message-4', senderId: 'hajun', text: '토요일 서울숲에서 피크닉 할까?', time: '13:28', kind: 'text' },
        { id: 'message-5', senderId: 'yujin', text: '오후 4시 좋아! 나는 간식 가져갈게.', time: '13:29', kind: 'text' },
        { id: 'message-6', senderId: viewerId, text: '좋아, 약속 후보부터 같이 확인하자.', time: '13:30', kind: 'text' },
      ],
      'direct-yujin': [
        { id: 'message-7', senderId: 'yujin', text: '다음 주 금요일에 전시 보러 가자!', time: '18:20', kind: 'text' },
        { id: 'message-8', senderId: viewerId, text: '오후 3시에 갤러리 봄에서 만나면 좋겠어.', time: '18:22', kind: 'text' },
      ],
    },
    proposalsByRoom,
    promises: [{
      id: 'promise-seed', roomId: 'group-weekend', title: '일요일 브런치 모임', date: '2026-10-18', time: '11:00', endTime: '12:30', place: '브런치 온기 · 합성 장소', notes: '미리 확정된 합성 예시예요.', hostId: viewerId, participantIds: ['me', 'minseo', 'hajun', 'yujin'], status: 'confirmed', version: 1,
      rsvp: { me: 'going', minseo: 'going', hajun: 'pending', yujin: 'maybe' },
      history: [history('created', '합성 예시 약속이 확정되었어요.', 1)],
    }],
  });
}

export function selectRoom(state, roomId) {
  roomExists(roomId);
  const next = clone(state);
  next.activeRoomId = roomId;
  return done(next);
}
export function setDraft(state, roomId, text) {
  roomExists(roomId);
  textValue(text, '메시지', { empty: true });
  const next = clone(state);
  next.draftsByRoom[roomId] = text;
  return done(next);
}
export function sendMessage(state, roomId, text) {
  roomExists(roomId);
  textValue(text, '메시지');
  const next = clone(state);
  const count = Object.values(next.messagesByRoom).flat().length;
  next.messagesByRoom[roomId].push({ id: `message-${count + 1}`, senderId: viewerId, text: text.trim(), time: '지금', kind: 'text' });
  next.draftsByRoom[roomId] = '';
  return done(next);
}
function versionCheck(item,version){if(!Number.isSafeInteger(version)||version!==item.version)throw new Error('내용이 바뀌었어요. 최신 날짜·시간·장소를 다시 확인해 주세요.');}
function actorCheck(item,actorId){if(typeof actorId!=='string'||!item.participantIds.includes(actorId))throw new Error('이 데모 약속의 가상 참여자만 확인할 수 있어요.');}
function isDirect(item){return rooms.find(room=>room.id===item.roomId)?.kind==='direct';}
function approvedPair(item,approvals,revision){return Object.keys(approvals).length===2&&item.participantIds.length===2&&new Set(item.participantIds).size===2&&item.participantIds.every(id=>approvals[id]===revision);}
export function isMutualFinal(item){return isDirect(item)&&item.status==='confirmed'&&!item.pendingChange&&approvedPair(item,item.approvals||{},item.version);}
export function proposalStage(item){if(item.status==='ignored')return 'ignored';if(item.phase==='negotiating')return 'negotiating';if(item.status==='confirmed')return isDirect(item)?(approvedPair(item,item.approvals,item.version)?'mutually_confirmed':'awaiting'):'host_confirmed';return Object.keys(item.approvals||{}).length?'waiting':'awaiting';}
export function confirmProposal(state,roomId,actorId=viewerId,expectedVersion){
 const proposal=proposalFor(state,roomId);actorCheck(proposal,actorId);versionCheck(proposal,expectedVersion);
 if(proposal.status==='confirmed')return done(clone(state));
 if(proposal.status!=='pending'||proposal.phase==='negotiating')throw new Error('조율할 내용을 먼저 수정한 뒤 다시 확인해 주세요.');
 if(!isDirect(proposal)&&actorId!==proposal.hostId)throw new Error('주최자 역할에서 일정을 확인해 주세요.');
 validateAppointment(proposal);const next=clone(state),item=next.proposalsByRoom[roomId];
 if(item.approvals[actorId]===item.version)return done(next);
 item.approvals[actorId]=item.version;item.history.push(history('approved',people[actorId].name+' 역할에서 이 내용을 확인했어요.',item.history.length+1));
 if(isDirect(item)&&!approvedPair(item,item.approvals,item.version))return done(next);
 const promiseId='promise-'+item.id;if(next.promises.some(p=>p.id===promiseId))throw new Error('이미 만들어진 약속이에요.');
 item.status='confirmed';item.promiseId=promiseId;
 next.promises.push({...clone(item),id:promiseId,status:'confirmed',rsvp:Object.fromEntries(item.participantIds.map(id=>[id,'pending'])),history:[...item.history,history('created',isDirect(item)?'두 가상 참여자가 같은 내용을 확인했어요.':'주최자가 일정을 확인했어요. 참석 응답은 각자 남겨요.',item.history.length+1)]});return done(next);
}

export function editProposal(state,roomId,patch,expectedVersion){
 const proposal=proposalFor(state,roomId);versionCheck(proposal,expectedVersion);if(proposal.status!=='pending')throw new Error('확정하거나 무시한 후보는 바로 수정할 수 없어요.');
 validatePatch(patch);const edited={...proposal,...patch};validateAppointment(edited);const next=clone(state);
 next.proposalsByRoom[roomId]={...edited,version:proposal.version+1,approvals:{},phase:'awaiting'};return done(next);
}
export function requestProposalChange(state,roomId,actorId,expectedVersion){const proposal=proposalFor(state,roomId);actorCheck(proposal,actorId);versionCheck(proposal,expectedVersion);if(!isDirect(proposal)||proposal.status!=='pending')throw new Error('확인 전인 두 사람의 후보만 조율할 수 있어요.');const next=clone(state),item=next.proposalsByRoom[roomId];item.version++;item.approvals={};item.phase='negotiating';item.history.push(history('requested',people[actorId].name+' 역할에서 변경을 요청했어요.',item.history.length+1));return done(next);}

export function ignoreProposal(state,roomId,expectedVersion){const proposal=proposalFor(state,roomId);versionCheck(proposal,expectedVersion);if(proposal.status==='confirmed')throw new Error('확정한 약속은 약속 상세에서 취소해 주세요.');const next=clone(state),item=next.proposalsByRoom[roomId];item.status='ignored';item.approvals={};item.version++;return done(next);}

export function reviveProposal(state,roomId){const proposal=proposalFor(state,roomId);if(proposal.status!=='ignored')throw new Error('무시한 후보만 다시 열 수 있어요.');const next=clone(state),item=next.proposalsByRoom[roomId];item.status='pending';item.phase='awaiting';item.approvals={};item.version++;return done(next);}

export function setRSVP(state,promiseId,personId,status,expectedVersion){const promise=promiseFor(state,promiseId);versionCheck(promise,expectedVersion);actorCheck(promise,personId);if(isDirect(promise)||promise.status!=='confirmed')throw new Error('확정한 그룹 일정의 참석 여부만 선택할 수 있어요.');if(!rsvpStatuses.has(status))throw new Error('참석, 미정, 불참 중에서 선택해 주세요.');const next=clone(state),item=promiseFor(next,promiseId);if(item.rsvp[personId]!==status){item.rsvp[personId]=status;item.history.push(history('rsvp',people[personId].name+' 역할의 참석 응답을 변경했어요.',item.history.length+1));}return done(next);}

export function updatePromise(state,promiseId,patch,expectedVersion,expectedChangeVersion){
 const promise=promiseFor(state,promiseId);versionCheck(promise,expectedVersion);if(promise.status==='cancelled')throw new Error('취소한 약속은 변경할 수 없어요.');
 if(promise.pendingChange&&expectedChangeVersion!==promise.pendingChange.revision)throw new Error('변경 후보가 바뀌었어요. 최신 내용을 다시 확인해 주세요.');
 validatePatch(patch);const edited={...promise,...patch};validateAppointment(edited);const next=clone(state),item=promiseFor(next,promiseId);
 if(!Object.keys(patch).some(key=>promise[key]!==patch[key])&&!promise.pendingChange)return done(next);
 if(isDirect(item)){const revision=(item.pendingChange?.revision||0)+1;item.pendingChange={baseVersion:item.version,revision,payload:Object.fromEntries([...editableFields].map(key=>[key,edited[key]])),approvals:{[viewerId]:revision},phase:'awaiting'};item.status='awaiting_confirmation';item.history.push(history('change-proposed','변경 후보를 제안했어요. 두 역할의 재확인이 필요해요.',item.history.length+1));}
 else{Object.assign(item,patch);item.version++;item.rsvp=Object.fromEntries(item.participantIds.map(id=>[id,'pending']));item.history.push(history('updated','주최자가 변경 내용을 확인했어요. 참석 여부를 다시 선택해 주세요.',item.history.length+1));}
 return done(next);
}
function pendingChangeFor(item,baseVersion,revision){versionCheck(item,baseVersion);const change=item.pendingChange;if(!change||change.baseVersion!==baseVersion||change.revision!==revision)throw new Error('오래된 변경 확인이에요. 최신 내용을 다시 확인해 주세요.');return change;}
export function confirmPromiseChange(state,promiseId,actorId,baseVersion,revision){const promise=promiseFor(state,promiseId);actorCheck(promise,actorId);const change=pendingChangeFor(promise,baseVersion,revision);if(change.phase!=='awaiting')throw new Error('조율한 내용을 먼저 수정해 주세요.');const next=clone(state),item=promiseFor(next,promiseId),candidate=item.pendingChange;if(candidate.approvals[actorId]===revision)return done(next);candidate.approvals[actorId]=revision;item.history.push(history('change-approved',people[actorId].name+' 역할에서 변경 내용을 확인했어요.',item.history.length+1));if(approvedPair(item,candidate.approvals,revision)){Object.assign(item,candidate.payload);item.version++;item.approvals=Object.fromEntries(item.participantIds.map(id=>[id,item.version]));item.status='confirmed';delete item.pendingChange;item.history.push(history('updated','두 역할이 변경 내용을 함께 확인했어요.',item.history.length+1));}return done(next);}
export function requestPromiseChange(state,promiseId,actorId,baseVersion,revision){const promise=promiseFor(state,promiseId);actorCheck(promise,actorId);pendingChangeFor(promise,baseVersion,revision);const next=clone(state),item=promiseFor(next,promiseId);item.pendingChange.revision++;item.pendingChange.approvals={};item.pendingChange.phase='negotiating';item.status='negotiating';item.history.push(history('requested','변경 후보를 다시 조율하고 있어요.',item.history.length+1));return done(next);}

export function cancelPromise(state,promiseId,expectedVersion){const promise=promiseFor(state,promiseId);versionCheck(promise,expectedVersion);if(promise.status==='cancelled')return done(clone(state));const next=clone(state),item=promiseFor(next,promiseId);item.status='cancelled';delete item.pendingChange;item.history.push(history('cancelled','주최자 역할에서 취소 내용을 확인했어요.',item.history.length+1));return done(next);}
export function scheduleEntries(state){return state.promises.filter(item=>item.status==='confirmed'&&!item.pendingChange&&(!isDirect(item)||isMutualFinal(item))).sort((a,b)=>(a.date+'T'+a.time).localeCompare(b.date+'T'+b.time));}


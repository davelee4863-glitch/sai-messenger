// Display policy only. Durable Object membership and consent remain authoritative.
export const NAVIGATION=[{label:'채팅',route:'rooms'},{label:'약속함',route:'promises'},{label:'일정',route:'schedule'}];
export const COPY={suggestion:'우리 사이에 약속 하나가 생긴 것 같아요. ♡',question:'이대로 확정할까요?',waiting:'상대방의 대답을 기다리고 있어요.',confirmed:'우리의 약속이 확정되었어요. ❤️',together:'우리의 약속을 함께 확인해 주세요 ♡'};
export const responseLabel={pending:'미응답',going:'참석',maybe:'미정',declined:'불참'};
export function mutuallyConfirmed(record){
 const c=record.confirmation;
 if(record.confirmationMode!=='mutual'||record.status!=='confirmed'||record.pendingChange||c?.state!=='mutually_confirmed'||!Number.isSafeInteger(c.version)||c.version<1||c.version!==record.version||!Array.isArray(c.participants)||c.participants.length!==2||!Array.isArray(c.approvals)||c.approvals.length!==2)return false;
 const people=c.participants.map(p=>p.id),approved=c.approvals.map(a=>a.user_id);
 return new Set(people).size===2&&new Set(approved).size===2&&people.every(id=>typeof id==='string'&&approved.includes(id));
}
export function mutualMessage(state,approvals,userId){
 if(state==='mutually_confirmed')return COPY.confirmed;
 if(state==='ignored')return '이번 후보는 무시했어요.';
 if(state==='legacy_unverified')return '이전 기록은 상호 확인 증거가 없어 새로 확인이 필요해요.';
 if(state==='negotiating')return '조율 중 · 내용을 다시 맞춘 뒤 함께 확인해 주세요.';
 return approvals.some(a=>a.user_id===userId)?COPY.waiting:COPY.together;
}
export function promiseLabel(promise){
 if(promise.status==='cancelled')return '취소된 약속';
 if(promise.confirmationMode!=='mutual')return '주최자 일정 확정';
 if(mutuallyConfirmed(promise))return '서로 확정';
 return promise.status==='negotiating'?'조율 중':'상호 확인 필요';
}
export function scheduleEntries(promises){return promises.filter(p=>p.status==='confirmed'&&!p.pendingChange&&(p.confirmationMode!=='mutual'||mutuallyConfirmed(p))).sort((a,b)=>(a.payload.date+'T'+a.payload.time).localeCompare(b.payload.date+'T'+b.payload.time)||a.id.localeCompare(b.id));}
export function rsvpRequest(promise,response){return {response,...(promise.confirmationMode?{expectedVersion:promise.version}:{})};}

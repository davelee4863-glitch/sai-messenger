import * as demo from './demo-state.mjs';
import {RELEASE} from './release.mjs';
import {createQR} from './qr.mjs';

let state = demo.createDemoState();
const ui = {homeTab:'chats', query:'', boxFilter:'upcoming', calendar:'Apple', toastTimer:null};
const $ = selector => document.querySelector(selector);
const main = $('#main');

function h(tag, attributes = {}, ...children) {
 const node = document.createElement(tag);
 if(tag === 'button') node.type = 'button';
 for(const [key,value] of Object.entries(attributes)) {
  if(value === undefined || value === null || (value === false && !key.startsWith('aria-'))) continue;
  if(key === 'text') node.textContent = String(value);
  else if(key === 'class') node.className = value;
  else if(key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(),value);
  else if(key === 'value') node.value = value;
  else if(key === 'disabled' || key === 'required') node[key] = Boolean(value);
  else node.setAttribute(key,String(value));
 }
 for(const child of children.flat(Infinity)) {
  if(child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
 }
 return node;
}
const paths = {
 chat:['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z','M8 11h8M8 14h5'],
 box:['m3 8 9-5 9 5-9 5-9-5Z','M3 8v10l9 5 9-5V8M12 13v10M8 5l9 5'],
 calendar:['M4 5h16v16H4z','M7 3v4M17 3v4M4 10h16M8 14h2M14 14h2M8 18h2'],
 people:['M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2','M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9','M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
 star:['m12 3 2.6 5.6 6.2.8-4.5 4.4 1.1 6.2-5.4-2.9-5.4 2.9 1.1-6.2L2.8 9.4l6.2-.8L12 3Z'],
 spark:['m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z'],
 arrow:['M5 12h14M13 6l6 6-6 6'],
 back:['M19 12H5M11 6l-6 6 6 6'],
 search:['M19 19l-4-4','M16 9.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z'],
 pin:['M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z','M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
 clock:['M12 8v5l3 2','M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
 check:['m5 12 4 4L19 6'],
 edit:['M12 20H4V4h8M16 3l5 5-10 10-5 1 1-5L16 3Z'],
 close:['M6 6l12 12M18 6 6 18'],
 link:['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7','M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
 info:['M12 11v6M12 7h.01','M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
 send:['m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13'],
 copy:['M9 9h12v12H9zM15 9V3H3v12h6'],
 phone:['M7 2h10v20H7zM11 18h2'],
 heart:['M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z']
};
function icon(name) {
 const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('class','icon'); svg.setAttribute('aria-hidden','true');
 for(const d of paths[name] || paths.box) { const path=document.createElementNS(ns,'path');path.setAttribute('d',d);svg.append(path); }
 return svg;
}
const btn = (text, onClick, kind='', name) => h('button',{class:'btn '+kind, onclick:onClick,'aria-label':name},text);
const link = (text,to,kind='') => h('a',{href:'#'+to,class:'btn '+kind},text);
function avatar(id, size='') {return h('span',{class:'avatar a-'+id+' '+size,'aria-hidden':'true'},demo.people[id]?.initial || '함');}
function avatars(ids) {return h('div',{class:'avatars','aria-label':ids.map(id=>demo.people[id]?.name||'참가자').join(', ')},ids.map(id=>avatar(id,'small')));}
function prettyDate(date) {return new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));}
function prettyTime(time) {const [hour,minute]=time.split(':').map(Number); return (hour<12?'오전 ':'오후 ')+(hour%12||12)+':'+String(minute).padStart(2,'0');}
function goto(path) {if(location.hash.slice(1)===path) render();else location.hash=path;}
function toast(message) {
 const node=$('#toast'); node.textContent=message;node.classList.add('visible');
 clearTimeout(ui.toastTimer);ui.toastTimer=setTimeout(()=>node.classList.remove('visible'),3400);
}
function act(action, after) {
 try {state=action(state);if(after) after();else render();return true;}
 catch(error) {toast(error.message);return false;}
}
function promiseById(id) {return state.promises.find(item=>item.id===id);}
function back(text,to) {return h('a',{href:'#'+to,class:'back-link'},icon('back'),text);}
function heading(title,description,backTo,backText='뒤로') {
 return h('div',{class:'screen-heading'},backTo?back(backText,backTo):null,
 h('h1',{tabindex:'-1',id:'page-heading'},title),description?h('p',{},description):null);
}
function notice(text,success=false) {return h('div',{class:'notice'+(success?' success':'')},icon(success?'check':'info'),h('p',{},text));}
function activeSection(view) {
 if(['promises','detail','attendees','change','calendar'].includes(view))return 'promises';
 return ['invite','about'].includes(view)?view:'home';
}
function chrome(view) {
 const selected=activeSection(view);
 const nav=[['home','chat','친구 · 채팅'],['promises','box','약속함'],['invite','link','초대 · 설치'],['about','info','버전 · 안내']];
 $('#sidebar').replaceChildren(
 h('a',{href:'#home',class:'brand','aria-label':'약속함 첫 화면'},h('img',{src:'./icon.svg',alt:'',width:'46',height:'46'}),h('span',{},h('strong',{},'약속함'),h('small',{},'PROMISE BOX'))),
 h('nav',{class:'side-nav','aria-label':'데스크톱 주요 메뉴'},nav.map(([route,glyph,text])=>h('a',{href:'#'+route,class:'side-link'+(selected===route?' active':''),'aria-current':selected===route?'page':null},icon(glyph),text))),
 h('div',{class:'side-note'},icon('heart'),h('strong',{},'좋은 순간을 기다리는 곳'),h('p',{},'작은 약속도 잊지 않도록, 따뜻하게 모아두어요.')),
 h('div',{class:'side-user'},avatar('me','small'),h('div',{},h('strong',{},'나의 미리보기'),h('div',{class:'muted'},'합성 데이터로 체험 중'))));
 $('#topbar').replaceChildren(
 h('a',{href:'#home',class:'mobile-brand','aria-label':'약속함 첫 화면'},h('img',{src:'./icon.svg',alt:'',width:'34',height:'34'}),'약속함'),
 h('span',{class:'topbar-label'},icon(nav.find(item=>item[0]===selected)?.[1]||'chat'),nav.find(item=>item[0]===selected)?.[2]),
 h('div',{class:'header-meta'},h('span',{class:'date-label'},'2026년 10월 13일 · 합성 예시'),h('span',{class:'preview-badge'},'UI V1 · 공개 합성 데모')));
 $('#mobile-nav').replaceChildren(...nav.map(([route,glyph,text])=>h('a',{href:'#'+route,class:'mobile-link'+(selected===route?' active':''),'aria-current':selected===route?'page':null},icon(glyph),text.replace('친구 · 채팅','채팅').replace('초대 · 설치','초대').replace('버전 · 안내','안내'))));
 $('#footer').replaceChildren(h('span',{},'서버 저장·실제 초대·캘린더 연동이 없는 디자인 체험입니다.'),h('a',{href:'#about'},'V'+RELEASE.version+' · '+(RELEASE.sourceCommit==='LOCAL_PREVIEW'?'로컬 미리보기':RELEASE.sourceCommit.slice(0,7))+' · 변경 내역'));
}
function roomRow(room) {
 const messages=state.messagesByRoom[room.id], last=messages.at(-1);
 return h('a',{href:'#chat/'+room.id,class:'room-row','aria-label':room.title+' '+(room.kind==='group'?'그룹 채팅':'1:1 채팅')},
 room.kind==='group'?h('span',{class:'avatar','aria-hidden':'true'},room.emoji):avatar(room.participantIds.find(id=>id!=='me')),
 h('div',{class:'room-copy'},h('div',{class:'room-title'},room.title,room.kind==='group'?h('span',{class:'mini-tag'},'그룹 '+room.participantIds.length):null),
 h('p',{class:'room-preview'},last?.text||room.preview)),
 h('div',{class:'room-meta'},h('span',{},room.when),room.unread?h('span',{class:'unread','aria-label':'미확인 '+room.unread+'개'},room.unread):icon('arrow')));
}
function roomListContents() {
 if(ui.homeTab==='friends') {
  const ids=Object.keys(demo.people).filter(id=>id!=='me'&&demo.people[id].name.includes(ui.query));
  if(!ids.length)return h('div',{class:'empty-state'},h('p',{},'일치하는 합성 친구가 없어요.'));
  return ids.map(id=>{
   const direct=demo.rooms.find(room=>room.kind==='direct'&&room.participantIds.includes(id));
   return h('a',{href:'#chat/'+(direct?.id||'group-weekend'),class:'room-row','aria-label':demo.people[id].name+' '+(direct?'1:1 채팅':'그룹에서 대화')},avatar(id),h('div',{class:'room-copy'},h('div',{class:'room-title'},demo.people[id].name),h('p',{class:'room-preview'},direct?'합성 친구 · 편하게 이야기해요':'합성 친구 · 우리의 주말 그룹에서 만나요')),icon('chat'));
  });
 }
 const list=roomsFiltered(); if(!list.length)return h('div',{class:'empty-state'},h('p',{},'일치하는 합성 대화가 없어요.'));
 return list.map(roomRow);
}
function roomsFiltered() {return demo.rooms.filter(room=>room.title.includes(ui.query)||room.preview.includes(ui.query));}
function home() {
 const recent=state.promises.find(item=>item.status==='confirmed');
 const grid=h('div',{class:'home-grid'},
 h('section',{},h('div',{class:'section-title'},h('h2',{},ui.homeTab==='friends'?'함께할 친구':'함께 나눈 이야기',h('span',{class:'count'},demo.rooms.length))),tabsHome(),
 h('div',{class:'search-wrap'},icon('search'),h('input',{class:'search',type:'search',value:ui.query,placeholder:'친구나 대화를 찾아보세요','aria-label':'친구 및 채팅 검색',oninput:event=>{
 ui.query=event.target.value; $('#home-room-list').replaceChildren(...[roomListContents()].flat()); }})),
 h('div',{id:'home-room-list',class:'room-list panel'},roomListContents())),
 h('aside',{class:'home-aside','aria-label':'예시 약속 안내'},
 h('section',{class:'mini-calendar panel'},h('div',{class:'mini-calendar-heading'},h('strong',{},'10월의 작은 약속'),h('span',{class:'muted'},'2026')),
 h('div',{class:'week'},['월','화','수','목','금','토','일'].map((day,index)=>h('div',{},h('div',{class:'week-day'},day),h('span',{class:'week-number'+(index===1?' today':'')+(index===6?' scheduled':'')},index+12)))),
 recent?h('a',{href:'#detail/'+recent.id,class:'upcoming'},h('p',{class:'mini-date'},prettyDate(recent.date)+' · '+prettyTime(recent.time)),h('strong',{},recent.title),h('p',{},recent.place),avatars(recent.participantIds)):h('div',{class:'upcoming'},h('p',{},'새 약속을 기다리고 있어요.'))),
 h('div',{class:'soft-note'},h('strong',{},'AI는 먼저 물어볼게요'),h('p',{},'약속 후보를 확인하고 내가 선택할 때만 약속함에 담겨요.'))));
 const content=h('div',{class:'fade-in'},
 h('section',{class:'hero panel'},h('div',{class:'hero-content'},
 h('div',{class:'eyebrow'},icon('spark'),'A LITTLE PROMISE, A GOOD DAY'),
 h('h1',{id:'page-heading',tabindex:'-1'},'일상의 좋은 순간을,',h('br'),h('em',{},'약속함'),'에 담아요.'),
 h('p',{},'이야기는 편하게, 약속은 차곡차곡.',h('br'),'함께 기다리는 시간을 더 가볍게 만들어볼까요?'),
 h('div',{class:'hero-actions'},link([icon('chat'),'대화 시작하기'],'chat/direct-minseo','primary'),link([icon('box'),'약속함 보기'],'promises'))),
 h('div',{class:'hero-art','aria-hidden':'true'},h('div',{class:'art-orbit'}),h('img',{src:'./icon.svg',alt:'',class:'art-box'}),
 h('div',{class:'art-card'},h('strong',{},'토요일의 커피 한 잔'),'10.17 · 오후 2:00'),h('span',{class:'art-spark'},'✦'))),grid);
 return content;
}
function tabsHome() {
 return h('div',{class:'tabs','aria-label':'친구 및 채팅 보기'},['chats','friends'].map((tab,index)=>h('button',{class:'tab'+(ui.homeTab===tab?' selected':''),'aria-pressed':ui.homeTab===tab,onclick:()=>{ui.homeTab=tab;ui.query='';render();}},index===0?'채팅':'친구')));
}
function chat(roomId) {
 const room=demo.rooms.find(item=>item.id===roomId);if(!room) return missing();
 if(state.activeRoomId!==roomId)state=demo.selectRoom(state,roomId);
 const proposal=state.proposalsByRoom[roomId];
 const messageNodes=state.messagesByRoom[roomId].map(message=>h('div',{class:'message'+(message.senderId==='me'?' mine':'')},
 message.senderId!=='me'?avatar(message.senderId,'small'):null,
 h('div',{class:'message-copy'},message.senderId!=='me'?h('div',{class:'message-name'},demo.people[message.senderId].name):null,h('p',{class:'bubble'},message.text)),
 h('span',{class:'message-time'},message.time)));
 const textarea=h('textarea',{rows:'1',maxlength:'2000',value:state.draftsByRoom[roomId],placeholder:'합성 메시지를 입력해 보세요','aria-label':room.title+' 메시지 작성',oninput:event=>{state=demo.setDraft(state,roomId,event.target.value);}});
 const submitMessage=()=>{
 if(!textarea.value.trim()){toast('메시지를 먼저 입력해 주세요.');textarea.focus();return;}
 act(current=>demo.sendMessage(current,roomId,textarea.value),()=>{render();$('.chat-compose textarea')?.focus();$('.chat-messages')?.scrollTo(0,$('.chat-messages').scrollHeight);});
 };
 textarea.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();submitMessage();}});
 return h('div',{class:'chat-layout fade-in'},
 h('aside',{class:'chat-room-menu panel','aria-label':'채팅방 전환'},h('h2',{},'나의 대화'),demo.rooms.map(item=>h('a',{href:'#chat/'+item.id,class:'chat-room-link'+(item.id===roomId?' active':''),'aria-current':item.id===roomId?'page':null},
 item.kind==='group'?h('span',{class:'avatar small','aria-hidden':'true'},item.emoji):avatar(item.participantIds[1],'small'),h('span',{},item.title)))),
 h('section',{class:'chat-window panel','aria-label':room.kind==='group'?'그룹 채팅':'1:1 채팅'},
 h('div',{class:'chat-head'},room.kind==='group'?h('span',{class:'avatar','aria-hidden':'true'},room.emoji):avatar(room.participantIds[1]),
 h('div',{class:'chat-head-copy'},h('h1',{id:'page-heading',tabindex:'-1'},room.title),h('p',{},room.kind==='group'?room.participantIds.length+'명 · 합성 그룹 채팅':'1:1 · 합성 채팅')),
 link([icon('link'),'초대'],'invite/group-weekend','subtle')),
 h('div',{class:'chat-messages','aria-label':'대화 내용'},h('div',{class:'chat-date'},'10월 13일 화요일 · 합성 대화'),messageNodes,
 h('div',{class:'ai-mini'},h('div',{class:'ai-label'},icon('spark'),'AI 약속 후보'),
 h('h2',{},proposal.title),h('p',{},prettyDate(proposal.date)+' · '+prettyTime(proposal.time)),
 link([proposal.status==='pending'?'이대로 확정할까요?':'후보 상태 확인하기',icon('arrow')],'candidate/'+roomId,'peach'))),
 h('div',{class:'chat-compose'},textarea,btn(icon('send'),submitMessage,'primary icon-only','메시지 보내기')),
 h('p',{class:'composer-note'},'내 브라우저 안에서만 체험해요. 채팅방을 바꿔도 초안은 유지돼요.')));
}
function details(item) {
 return h('div',{},
 h('div',{class:'info-grid'},h('div',{class:'info-block'},h('div',{class:'info-label'},icon('calendar'),'날짜'),h('strong',{},prettyDate(item.date)),h('small',{},item.date.slice(0,4)+'년 · 한국 시간')),
 h('div',{class:'info-block'},h('div',{class:'info-label'},icon('clock'),'시간'),h('strong',{},prettyTime(item.time)+' – '+prettyTime(item.endTime)),h('small',{},'Asia/Seoul'))),
 h('dl',{},h('div',{class:'document-row'},h('dt',{},'만날 곳'),h('dd',{},item.place)),
 h('div',{class:'document-row'},h('dt',{},'함께할 사람'),h('dd',{},item.participantIds.map(id=>demo.people[id].name).join(', ')),avatars(item.participantIds)),
 h('div',{class:'document-row'},h('dt',{},'작은 메모'),h('dd',{},item.notes||'편하게 만나서 이야기해요.'))));
}
function candidate(roomId) {
 const item=state.proposalsByRoom[roomId];if(!item)return missing();
 const pending=item.status==='pending', isGroup=demo.rooms.find(room=>room.id===roomId).kind==='group';
 const decision=h('aside',{class:'decision-card panel'},h('div',{class:'ai-label'},icon('spark'),'AI는 제안만 해요'),
 h('h2',{},pending?'이대로 확정할까요?':item.status==='ignored'?'잠시 접어둔 후보예요':'선택을 마친 약속이에요'),
 h('p',{},isGroup?'주최자의 약속 확정과 각 참석자의 응답은 따로 관리해요.':'내가 확인하고 선택할 때만 약속함에 담겨요.'),
 h('div',{class:'decision-actions'},pending?[
 btn([icon('check'),'이대로 확정'],()=>act(current=>demo.confirmProposal(current,roomId),()=>{toast('약속함에 담았어요. 참석 응답은 따로 확인해요.');goto('detail/'+state.proposalsByRoom[roomId].promiseId);}),'primary wide'),
 btn([icon('edit'),'수정하기'],()=>proposalEdit(roomId),'wide'),
 btn('무시하기',()=>act(current=>demo.ignoreProposal(current,roomId),()=>{render();toast('후보를 접어두었어요. 약속은 생성되지 않았어요.');}),'subtle wide')
 ]:item.status==='ignored'?[
 btn('후보 다시 확인하기',()=>act(current=>demo.reviveProposal(current,roomId)),'peach wide'),link('대화로 돌아가기','chat/'+roomId,'wide')
 ]:[link([icon('box'),'약속 문서 보기'],'detail/'+item.promiseId,'primary wide'),link('대화로 돌아가기','chat/'+roomId,'wide')]),
 h('p',{class:'decision-help'},'확정 전에는 약속이 생성되지 않아요. 모든 변경은 이 데모 세션에만 반영돼요.'));
 return h('div',{class:'fade-in'},heading('약속 후보를 확인해요','대화 속 좋은 순간을, 나의 선택으로 담아요.','chat/'+roomId,'채팅으로 돌아가기'),
 h('div',{class:'detail-grid'},h('article',{class:'document-card panel'},h('div',{class:'document-top'},h('span',{class:'document-number'},'PROMISE CANDIDATE'),h('span',{class:'pill pending'},pending?'확정 전 후보':item.status==='ignored'?'무시한 후보':'명시 확정됨')),
 h('h2',{},item.title),h('p',{class:'document-intro'},'대화에서 발견한 약속 후보입니다. 내용이 맞는지 먼저 살펴보세요.'),details(item)),decision));
}
function promiseCard(item) {
 const answered=Object.values(item.rsvp).filter(value=>value!=='pending').length;
 return h('a',{href:'#detail/'+item.id,class:'promise-card panel'},
 h('div',{class:'document-top'},h('span',{class:'pill'+(item.status==='cancelled'?' cancelled':'')},item.status==='cancelled'?'취소됨':'주최자 확정'),h('span',{class:'mini-tag'},demo.rooms.find(room=>room.id===item.roomId).kind==='group'?'그룹 약속':'1:1 약속')),
 h('h2',{},item.title),h('p',{class:'promise-date'},icon('calendar'),prettyDate(item.date)+' · '+prettyTime(item.time)),
 h('p',{class:'promise-place'},icon('pin'),item.place),
 h('div',{class:'card-bottom'},avatars(item.participantIds),h('small',{},'참석 응답 '+answered+'/'+item.participantIds.length+'명')));
}
function promises() {
 const items=state.promises.filter(item=>ui.boxFilter==='all'||(ui.boxFilter==='upcoming'?item.status==='confirmed':item.status==='cancelled'));
 return h('div',{class:'fade-in'},heading('약속함','내가 확인한 약속을 차곡차곡 모았어요.'),
 h('div',{class:'chips'},[['upcoming','다가오는 약속'],['all','전체'],['cancelled','취소된 약속']].map(([id,text])=>h('button',{class:'chip'+(ui.boxFilter===id?' active':''),'aria-pressed':ui.boxFilter===id,onclick:()=>{ui.boxFilter=id;render();}},text))),
 notice('확정된 합성 예시 1건으로 시작해요. AI 후보를 직접 확정하면 이 세션의 목록에 추가돼요.'),
 items.length?h('div',{class:'promise-grid'},items.map(promiseCard)):empty('아직 담긴 약속이 없어요','대화에서 약속 후보를 확인해보세요.','chat/direct-minseo','대화 보러 가기'));
}
function detail(id) {
 const item=promiseById(id);if(!item)return missing();
 const isCancelled=item.status==='cancelled', answered=Object.values(item.rsvp).filter(value=>value!=='pending').length;
 return h('div',{class:'fade-in'},heading('약속 상세 문서','함께할 시간을 한 장에 담았어요.','promises','약속함으로'),
 h('div',{class:'detail-grid'},h('article',{class:'document-card panel'},
 h('div',{class:'document-top'},h('span',{class:'document-number'},'PROMISE BOX / '+item.id.replace('promise-','').toUpperCase()),h('span',{class:'pill'+(isCancelled?' cancelled':'')},isCancelled?'취소된 약속':'주최자 확정 완료')),
 h('h2',{},item.title),h('p',{class:'document-intro'},'주최자 '+demo.people[item.hostId].name+' · 참석 응답은 별도로 확인해요.'),
 isCancelled?notice('취소된 합성 약속입니다. 실제 알림이나 외부 일정 변경은 없어요.'):null,details(item),
 h('p',{class:'document-bottom'},icon('info'),'공개 합성 데모예요. 새로고침하면 예시 상태로 돌아갑니다.')),
 h('aside',{},h('section',{class:'decision-card panel'},h('h2',{},'함께 확인할까요?'),h('p',{},'참석 응답 '+answered+'/'+item.participantIds.length+'명 · 확정과 RSVP는 별개예요.'),
 h('div',{class:'decision-actions'},link([icon('people'),'참석자 확인'],'attendees/'+id,'peach wide'),
 isCancelled?h('p',{class:'small-text muted'},'취소된 약속은 변경하지 않아요.'):link([icon('edit'),'일정 변경 · 취소'],'change/'+id,'wide'),
 isCancelled?null:link([icon('calendar'),'캘린더 추가 체험'],'calendar/'+id,'wide'))),
 h('section',{class:'soft-note'},h('strong',{},'약속의 발자취'),h('ul',{class:'history-list'},item.history.map(entry=>h('li',{},entry.text)))))));
}
const rsvpLabel={pending:'응답 대기',going:'참석해요',maybe:'미정이에요',declined:'불참해요'};
function attendees(id) {
 const item=promiseById(id);if(!item)return missing();
 return h('div',{class:'fade-in'},heading('그룹 참석자 확인','주최자의 확정은 참석자의 동의를 대신하지 않아요.','detail/'+id,'약속 문서로'),
 h('article',{class:'document-card panel'},h('h2',{},item.title),h('p',{class:'document-intro'},prettyDate(item.date)+' · '+prettyTime(item.time)),
 notice('각자의 RSVP를 별도로 바꿔보세요. 아래 응답은 모두 가상 참가자의 데모 상태입니다.'),
 h('div',{class:'participant-list'},item.participantIds.map(personId=>h('div',{class:'participant'},avatar(personId),
 h('div',{class:'participant-copy'},h('strong',{},demo.people[personId].name+(personId==='me'?' (데모)':'')),h('small',{},personId===item.hostId?'주최자 · 참석 응답은 별도':'참석자'),
 h('div',{class:'rsvp-buttons'},[['going','참석'],['maybe','미정'],['declined','불참']].map(([value,text])=>h('button',{class:'chip'+(item.rsvp[personId]===value?' active':''),'aria-pressed':item.rsvp[personId]===value,'aria-label':demo.people[personId].name+' '+text,disabled:item.status==='cancelled',onclick:()=>act(current=>demo.setRSVP(current,id,personId,value),()=>{render();toast(demo.people[personId].name+'님의 합성 응답을 변경했어요.');})},text)))),
 h('span',{class:'pill rsvp-'+item.rsvp[personId]},rsvpLabel[item.rsvp[personId]]))))));
}
function appointmentForm(item,submit,label) {
 const fields={};
 function field(name,title,type,full=false) {
  const input=h(type==='textarea'?'textarea':'input',{type:type==='textarea'?null:type,value:item[name],required:name!=='notes',maxlength:name==='title'?'80':name==='place'?'200':name==='notes'?'2000':null,id:'form-'+name});
  fields[name]=input;return h('label',{class:'field'+(full?' full':'')},title,input);
 }
 const error=h('p',{class:'form-error',role:'alert'});
 const form=h('form',{onsubmit:event=>{event.preventDefault();try{submit(Object.fromEntries(Object.entries(fields).map(([name,node])=>[name,node.value])));error.textContent='';}catch(issue){error.textContent=issue.message;}}},
 h('div',{class:'form-grid'},field('title','약속 이름','text',true),field('date','날짜 · 한국 시간','date',true),field('time','시작 시간','time'),field('endTime','종료 시간','time'),field('place','만날 곳','text',true),field('notes','작은 메모','textarea',true)),error,
 h('div',{class:'form-actions'},h('button',{type:'submit',class:'btn primary'},icon('check'),label)));
 return form;
}
function openDialog(title,content) {
 const previous=document.activeElement;
 const dialog=h('dialog',{'aria-label':title},h('div',{class:'dialog-content'},h('div',{class:'dialog-heading'},h('h2',{},title),btn(icon('close'),()=>dialog.close(),'icon-only subtle','닫기')),content));
 dialog.addEventListener('close',()=>{dialog.remove();if(previous?.isConnected)previous.focus();});
 document.body.append(dialog);dialog.showModal();return dialog;
}
function proposalEdit(roomId) {
 const form=appointmentForm(state.proposalsByRoom[roomId],patch=>{
 state=demo.editProposal(state,roomId,patch);dialog.close();render();toast('후보를 수정했어요. 아직 확정되지 않았어요.');
 },'후보 수정 완료');
 const dialog=openDialog('약속 후보 수정하기',h('div',{},h('p',{},'내용을 바꿔도 약속은 자동 확정되지 않아요.'),form));
}
function change(id) {
 const item=promiseById(id);if(!item)return missing();if(item.status==='cancelled')return empty('이미 취소된 약속이에요','취소된 약속의 문서를 확인할 수 있어요.','detail/'+id,'문서로 돌아가기');
 const form=appointmentForm(item,patch=>{
 const dialog=openDialog('이 내용으로 변경할까요?',h('div',{},h('h3',{},patch.title),details({...item,...patch}),
 notice('변경을 확정하면 참석 응답은 다시 대기 상태가 됩니다. 실제 알림은 보내지 않아요.'),
 h('div',{class:'form-actions'},btn('돌아가기',()=>dialog.close()),btn('변경 확정',()=>{if(act(current=>demo.updatePromise(current,id,patch),()=>{dialog.close();toast('합성 약속을 변경했어요. RSVP를 다시 확인해요.');goto('detail/'+id);})){}},'primary'))));
 },'변경 내용 확인');
 return h('div',{class:'fade-in'},heading('일정 변경 · 취소','변경 내용을 먼저 확인한 다음 반영해요.','detail/'+id,'약속 문서로'),
 h('article',{class:'document-card panel'},form,h('div',{class:'cancel-panel'},h('div',{},h('strong',{},'이 약속을 취소할까요?'),h('p',{},'확인 전에는 원래 약속이 유지됩니다.')),
 btn('취소 내용 확인',()=>cancelDialog(id),'danger'))));
}
function cancelDialog(id) {
 const dialog=openDialog('약속을 취소할까요?',h('div',{},h('p',{},'이 데모의 약속 상태만 취소로 바뀌어요. 실제 알림이나 캘린더 변경은 없어요.'),
 h('div',{class:'form-actions'},btn('유지하기',()=>dialog.close()),btn('약속 취소 확정',()=>act(current=>demo.cancelPromise(current,id),()=>{dialog.close();toast('합성 약속을 취소했어요.');goto('detail/'+id);}),'primary'))));
}
function calendar(id) {
 const item=promiseById(id);if(!item)return missing();
 if(item.status==='cancelled')return empty('취소된 약속은 추가하지 않아요','약속 문서에서 상태를 확인해주세요.','detail/'+id,'약속 문서로');
 return h('div',{class:'fade-in'},heading('캘린더 추가 화면','연결 없이, 추가 전 확인 흐름을 체험해요.','detail/'+id,'약속 문서로'),
 h('article',{class:'document-card panel'},h('h2',{},item.title),h('p',{class:'document-intro'},prettyDate(item.date)+' · '+prettyTime(item.time)),
 notice('이 화면은 미리보기입니다. 실제 캘린더에 쓰거나 파일을 내려받지 않아요.'),
 h('div',{class:'calendar-options','aria-label':'캘린더 체험 종류'},['Apple','Google','Outlook'].map(name=>h('button',{class:'calendar-choice'+(ui.calendar===name?' selected':''),'aria-pressed':ui.calendar===name,onclick:()=>{ui.calendar=name;render();}},icon('calendar'),h('div',{},name+' 캘린더')))),
 details(item),btn([icon('check'),'추가 흐름 체험하기'],()=>openDialog('캘린더 추가 체험',h('div',{},h('p',{},ui.calendar+' 캘린더의 추가 전 확인 화면을 체험했어요. 실제 일정은 바뀌지 않았습니다.'),notice('외부 연결 0건 · 이 화면에서 체험이 끝나요.',true))),'primary wide')));
}
function invite() {
 const url=new URL(location.pathname+'#invite/group-weekend',location.origin).href;
 return h('div',{class:'fade-in'},heading('좋은 시간을 함께 나눠요','공개 미리보기 링크와 설치 안내를 확인해보세요.'),
 h('div',{class:'detail-grid'},h('article',{class:'document-card panel'},h('div',{class:'ai-label'},icon('link'),'LINK & QR INVITATION'),h('h2',{},'링크·QR 초대'),
 h('p',{class:'document-intro'},'친구에게 공유할 수 있는 합성 데모 링크예요. 실제 가입이나 방 초대는 일어나지 않아요.'),
 h('code',{class:'invite-link'},url),btn([icon('copy'),'데모 링크 복사'],async()=>{
 try {await navigator.clipboard.writeText(url);toast('공개 데모 링크를 복사했어요.');}catch {toast('복사가 제한됐어요. 위 링크를 길게 눌러 복사해 주세요.');}
 },'primary'),h('div',{class:'document-row'},h('h3',{},'초대 흐름을 체험해볼까요?'),h('p',{class:'small-text muted'},'합성 그룹 채팅으로 이동합니다. 실제 참석자 정보는 사용하지 않아요.'),link([icon('people'),'그룹 데모 참여하기'],'chat/group-weekend','peach')),
 h('div',{class:'document-row'},h('h3',{},'PWA 설치 안내'),h('p',{class:'small-text muted'},'휴대전화 홈 화면에서 이 미리보기를 빠르게 열 수 있어요.'),
 h('ol',{class:'install-steps'},h('li',{},'iPhone · Safari에서 공유 버튼 → 홈 화면에 추가'),h('li',{},'Android · Chrome 메뉴 → 홈 화면에 추가 또는 앱 설치'),h('li',{},'PC · 브라우저의 앱 설치 메뉴 또는 즐겨찾기 사용')),
 notice('설치 메뉴는 기기마다 달라요. 이 미리보기는 인터넷 연결이 필요하며 오프라인·알림 기능은 제공하지 않아요.'))),
 h('aside',{class:'qr-card panel'},h('h2',{},'휴대전화로 열어보세요'),createQR(url),h('p',{},'카메라로 QR을 읽으면 같은 공개 데모로 이동해요.'),h('p',{class:'small-text'},'실제 사용자 초대가 아닌 체험 링크입니다.'))));
}
function about() {
 const updated=new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(RELEASE.updatedAt));
 return h('div',{class:'fade-in'},heading('조금씩 더 좋아지는 약속함','지금 보고 있는 미리보기의 버전과 변경 내역이에요.'),
 h('article',{class:'version-card panel'},h('div',{class:'eyebrow'},icon('box'),'PROMISE BOX / UI V1'),h('h2',{},'V'+RELEASE.version),
 h('dl',{},h('dt',{},'배포 코드'),h('dd',{},RELEASE.sourceCommit==='LOCAL_PREVIEW'?'아직 게시되지 않은 로컬 미리보기':RELEASE.sourceCommit),h('dt',{},'업데이트'),h('dd',{},updated+' KST'),h('dt',{},'데이터'),h('dd',{},'모든 이름·대화·약속은 합성 예시')),
 h('h3',{class:'document-row'},'이번 업데이트'),h('ul',{class:'changelog'},RELEASE.changes.map(text=>h('li',{},text))),
 h('div',{class:'document-row'},notice('새로고침하면 합성 예시로 초기화돼요. 실제 서버 저장·로그인·AI 호출·캘린더 연결은 없습니다.')),
 h('div',{class:'demo-reset'},h('p',{},'처음부터 다시 체험해보고 싶나요?'),btn('데모 초기화',()=>{const dialog=openDialog('데모를 초기화할까요?',h('div',{},h('p',{},'이 세션에서 바꾼 합성 메시지와 약속이 예시 상태로 돌아갑니다.'),btn('초기화 확인',()=>{state=demo.createDemoState();ui.query='';ui.boxFilter='upcoming';dialog.close();goto('home');toast('처음의 합성 예시로 돌아왔어요.');},'primary')));},'peach'))));
}
function empty(title,text,to,label) {return h('section',{class:'empty-state panel'},icon('box'),h('h1',{id:'page-heading',tabindex:'-1'},title),h('p',{},text),link(label,to,'primary'));}
function missing() {return empty('이 데모 화면을 찾을 수 없어요','화면을 처음부터 다시 확인해볼까요?','home','첫 화면으로');}
function render() {
 const [rawView,id]=location.hash.slice(1).split('/'),view=rawView||'home';
 chrome(view);
 const screens={home,chat:()=>chat(id||state.activeRoomId),candidate:()=>candidate(id||state.activeRoomId),promises,detail:()=>detail(id),attendees:()=>attendees(id),change:()=>change(id),calendar:()=>calendar(id),invite,about};
 const content=(screens[view]||missing)();
 main.replaceChildren(content);document.title='약속함 · '+(document.querySelector('#page-heading')?.textContent||'PROMISE BOX');
}
window.addEventListener('hashchange',()=>{
 if(location.hash==='#main'){main.focus();return;}
 render();window.scrollTo(0,0);$('#page-heading')?.focus({preventScroll:true});
});
render();


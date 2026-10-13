// Browser-only regression suite. Call runUIRegression(tab, base) through cua_repl.
// The tab must expose the documented cua Playwright API. This is not a Node test suite.
export async function runUIRegression(tab, base) {
 const results=[];
 const check=(name, condition, evidence)=>{results.push({name,status:condition?'PASS':'FAIL',evidence});if(!condition)throw new Error(name+' failed: '+JSON.stringify(evidence));};
 const route=async(path,heading)=>{await tab.goto(base+'#'+path);await tab.playwright.getByRole('heading',{name:heading,exact:true}).waitFor({state:'visible'});};
 const button=name=>tab.playwright.getByRole('button',{name,exact:true});
 const link=name=>tab.playwright.getByRole('link',{name,exact:true});
 const field=name=>tab.playwright.getByRole('textbox',{name,exact:true});
 const mainText=()=>tab.playwright.locator('main').innerText();
 await tab.reload();
 await route('chat/direct-minseo','민서');
 await field('민서 메시지 작성').fill('방을 바꿔도 남는 합성 초안');
 await route('chat/group-weekend','우리의 주말');
 await field('우리의 주말 메시지 작성').fill('<img src=x onerror=alert(1)> 합성 XSS 검사');
 await button('메시지 보내기').click();
 const xss=await tab.playwright.evaluate(()=>({injected:document.querySelectorAll('main img,main script').length,text:document.querySelector('main').textContent.includes('<img src=x onerror=alert(1)> 합성 XSS 검사')}));
 check('message XSS is literal text',xss.injected===0&&xss.text,xss);
 await route('chat/direct-minseo','민서');
 const draft=await tab.playwright.evaluate(()=>document.querySelector('textarea').value);
 check('room draft survives room change',draft==='방을 바꿔도 남는 합성 초안',draft);
 await route('candidate/direct-minseo','약속 후보를 확인해요');
 check('AI asks for explicit confirmation',(await mainText()).includes('이대로 확정할까요?'),await mainText());
 await button('수정하기').click();await field('약속 이름').fill('수정한 합성 후보');await button('후보 수정 완료').click();
 check('editing a candidate keeps it pending',(await mainText()).includes('확정 전 후보'),await mainText());
 await button('무시하기').click();
 check('ignore has no confirmation action',!(await mainText()).includes('이대로 확정할까요?'),await mainText());
 await route('promises','약속함');
 check('pending or ignored candidate is absent from promises',!(await mainText()).includes('수정한 합성 후보'),await mainText());
 await route('candidate/group-weekend','약속 후보를 확인해요');await button('이대로 확정').click();
 await tab.playwright.getByRole('heading',{name:'약속 상세 문서',exact:true}).waitFor({state:'visible'});
 check('host confirmation does not answer RSVP',(await mainText()).includes('참석 응답 0/4명'),await mainText());
 await link('참석자 확인').click();await tab.playwright.getByRole('heading',{name:'그룹 참석자 확인',exact:true}).waitFor({state:'visible'});
 await button('민서 참석').click();await button('하준 불참').click();await button('유진 미정').click();
 const rsvp=await tab.playwright.evaluate(()=>Array.from(document.querySelectorAll('.participant')).map(node=>node.textContent));
 check('individual group RSVP states are distinct',rsvp.some(t=>t.includes('민서')&&t.includes('참석'))&&rsvp.some(t=>t.includes('하준')&&t.includes('불참'))&&rsvp.some(t=>t.includes('유진')&&t.includes('미정')),rsvp);
 await route('change/promise-seed','일정 변경 · 취소');
 await field('날짜 · 한국 시간').fill('2027-01-03');await field('종료 시간').fill('13:45');await field('만날 곳').fill('카페 크림 · 합성 변경 장소');await field('작은 메모').fill('새해에 만나요 · 합성 메모');
 await button('변경 내용 확인').click();
 const summary=await tab.playwright.getByRole('dialog',{name:'이 내용으로 변경할까요?',exact:true}).innerText();
 check('change review shows year/end/place/notes',summary.includes('2027년')&&summary.includes('오후 1:45')&&summary.includes('카페 크림 · 합성 변경 장소')&&summary.includes('새해에 만나요 · 합성 메모'),summary);
 await button('돌아가기').click();await link('약속 문서로').click();await tab.playwright.getByRole('heading',{name:'약속 상세 문서',exact:true}).waitFor({state:'visible'});
 const original=await mainText();
 check('backing out preserves original promise',original.includes('2026년')&&original.includes('브런치 온기 · 합성 장소')&&!original.includes('카페 크림 · 합성 변경 장소'),original);
 await route('change/promise-seed','일정 변경 · 취소');await field('만날 곳').fill('카페 크림 · 합성 변경 장소');await button('변경 내용 확인').click();await button('변경 확정').click();
 await tab.playwright.getByRole('heading',{name:'약속 상세 문서',exact:true}).waitFor({state:'visible'});
 const changed=await mainText();check('confirmed change updates promise and resets RSVP',changed.includes('카페 크림 · 합성 변경 장소')&&changed.includes('참석 응답 0/4명'),changed);
 await route('calendar/promise-seed','캘린더 추가 화면');await button('Google 캘린더').click();await button('추가 흐름 체험하기').click();
 const calendar=await tab.playwright.getByRole('dialog',{name:'캘린더 추가 체험',exact:true}).innerText();
 check('calendar interaction is explicitly simulated',calendar.includes('Google')&&calendar.includes('외부 연결 0건'),calendar);
 await button('닫기').press('Escape');
 await tab.playwright.getByRole('dialog',{name:'캘린더 추가 체험',exact:true}).waitFor({state:'detached'});
 await tab.playwright.domSnapshot();
 const focus=await tab.playwright.evaluate(()=>({dialogs:document.querySelectorAll('dialog[open]').length,focus:document.activeElement.textContent}));
 check('Escape dismisses dialog and restores focus',focus.dialogs===0&&focus.focus==='추가 흐름 체험하기',focus);
 await route('change/promise-seed','일정 변경 · 취소');await button('취소 내용 확인').click();await button('유지하기').click();await link('약속 문서로').click();await tab.playwright.getByRole('heading',{name:'약속 상세 문서',exact:true}).waitFor({state:'visible'});
 check('cancellation requires final confirmation',!(await mainText()).includes('취소된 약속'),await mainText());
 await route('change/promise-seed','일정 변경 · 취소');await button('취소 내용 확인').click();await button('약속 취소 확정').click();await tab.playwright.getByRole('heading',{name:'약속 상세 문서',exact:true}).waitFor({state:'visible'});
 check('explicit cancellation is visible',(await mainText()).includes('취소된 약속'),await mainText());
 await route('invite','좋은 시간을 함께 나눠요');
 const invite=await tab.playwright.evaluate(()=>({url:document.querySelector('.invite-link').textContent,qr:document.querySelector('svg[role="img"]').getAttribute('aria-label'),install:document.querySelector('main').textContent.includes('PWA 설치 안내')}));
 check('invitation points to the current demo origin only',invite.url===base+'#invite/group-weekend'&&invite.install&&invite.qr.includes('QR'),invite);
 const logs=await tab.dev.logs({levels:['error','warn']});check('no browser warnings or console errors',logs.length===0,logs);
 await tab.reload();
 return {suite:'cua browser functional regressions',total:results.length,pass:results.filter(t=>t.status==='PASS').length,fail:results.filter(t=>t.status==='FAIL').length,results};
}

export const screenRoutes=[
 ['home','일상의 좋은 순간을, 약속함에 담아요.'],['chat/direct-minseo','민서'],['chat/group-weekend','우리의 주말'],['candidate/direct-minseo','약속 후보를 확인해요'],['promises','약속함'],['detail/promise-seed','약속 상세 문서'],['attendees/promise-seed','그룹 참석자 확인'],['change/promise-seed','일정 변경 · 취소'],['calendar/promise-seed','캘린더 추가 화면'],['invite','좋은 시간을 함께 나눠요'],['about','조금씩 더 좋아지는 약속함']
];
export async function checkScreenLayout(tab,base,width,height) {
 const results=[];
 for(const [route,heading] of screenRoutes) {
  await tab.goto(base+'#'+route);await tab.playwright.getByRole('heading',{name:heading,exact:true}).waitFor({state:'visible'});
  const evidence=await tab.playwright.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,h1:document.querySelector('main h1').textContent,mobileNavLinks:document.querySelectorAll('#mobile-nav a').length,unnamedControls:Array.from(document.querySelectorAll('main button,main input,main textarea')).filter(e=>!e.getAttribute('aria-label')&&!e.labels?.length&&!e.textContent.trim()).length,overflows:Array.from(document.querySelectorAll('main button,main input,main textarea,main h1,main h2,#mobile-nav a')).filter(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&r.width>0&&(r.right>innerWidth+1||r.left< -1)}).map(e=>({tag:e.tagName,text:e.textContent.slice(0,70)}))}));
  results.push({route,width,height,status:evidence.documentWidth<=width+1&&evidence.overflows.length===0&&evidence.unnamedControls===0&&(width>640||evidence.mobileNavLinks===4)?'PASS':'FAIL',evidence});
 }
 return results;
}

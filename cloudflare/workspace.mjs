import {DurableObject} from 'cloudflare:workers';
import {CloudStore} from './store.mjs';
import {localOrigin} from './origin.mjs';
import {Fault,fail,keys,text,uuid,digest,token,equal,passwordMatches} from '../mvp/security.mjs';
const COOKIE='pb_cf_local_session';
const ASSETS=new Set(['/','/index.html','/app.mjs','/styles.css','/icon.svg','/socket-url.mjs']);
function rawCookie(request){const values=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(COOKIE+'='));return values.length===1&&/^[a-f0-9]{64}$/.test(values[0].slice(COOKIE.length+1))?values[0].slice(COOKIE.length+1):null;}
async function body(request){if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')fail(415,'JSON_REQUIRED','JSON 요청만 허용합니다.');const reader=request.body?.getReader();let size=0,parts=[];if(!reader)fail(400,'INVALID_JSON','JSON 요청을 확인해주세요.');while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();fail(413,'BODY_TOO_LARGE','요청 크기가 너무 큽니다.');}parts.push(value);}const data=new Uint8Array(size);let offset=0;for(const p of parts){data.set(p,offset);offset+=p.length;}try{return JSON.parse(new TextDecoder().decode(data));}catch{fail(400,'INVALID_JSON','JSON 요청을 확인해주세요.');}}
export class Workspace extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.store=new CloudStore(ctx);this.pendingLogins=0;this.flushing=null;}
 auth(request,touch=true){const raw=rawCookie(request),session=raw?this.store.session(digest(raw),{idleMs:Number(this.env.SESSION_IDLE_MS||900000),touch}):null;if(!session)fail(401,'UNAUTHENTICATED','로그인이 필요합니다.');return {...session,csrf:digest('csrf:'+raw)};}
 valid(ws){const a=ws.deserializeAttachment();return a&&this.store.session(a.hash,{idleMs:Number(this.env.SESSION_IDLE_MS||900000),touch:false})&&this.store.member(a.roomId,a.userId)?a:null;}
 notify(roomId){for(const ws of this.ctx.getWebSockets()){const a=this.valid(ws);if(!a){ws.close(1008,'Access revoked');continue;}if(a.roomId===roomId)try{ws.send(JSON.stringify({type:'room.changed',roomId}));}catch{ws.close(1011,'Reconnect');}}}
 closeHash(hash){for(const ws of this.ctx.getWebSockets())if(ws.deserializeAttachment()?.hash===hash)ws.close(1008,'Session revoked');}
 options(){return {requests:Number(this.env.REQUEST_BUDGET||80000),reads:Number(this.env.READ_BUDGET||4000000),writes:Number(this.env.WRITE_BUDGET||80000),blocked:this.env.QUOTA_PAUSED==='true'};}
 async flush(){if(this.flushing)return this.flushing;this.flushing=(async()=>{try{if(this.env.D1_FAILURE==='true')throw new Error('injected');const rows=this.store.all('SELECT * FROM cf_outbox ORDER BY seq LIMIT 20');
   await this.env.META.prepare('CREATE TABLE IF NOT EXISTS workspace_projection (workspace TEXT PRIMARY KEY,epoch INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL)').run();
   const epoch=Number(this.store.get("SELECT value FROM cf_meta WHERE key='epoch'").value);
   for(const row of rows){await this.env.META.prepare('INSERT INTO workspace_projection VALUES (?,?,?,?) ON CONFLICT(workspace) DO UPDATE SET epoch=excluded.epoch,revision=excluded.revision,payload=excluded.payload WHERE excluded.epoch>epoch OR (excluded.epoch=epoch AND excluded.revision>=revision)').bind(this.ctx.id.toString(),epoch,row.seq,row.payload).run();
    const ack=await this.env.META.prepare('SELECT epoch,revision,payload FROM workspace_projection WHERE workspace=?').bind(this.ctx.id.toString()).first();
    if(!ack||ack.epoch!==epoch||ack.revision!==row.seq||ack.payload!==row.payload)throw new Error('Projection not acknowledged');
    this.store.run('DELETE FROM cf_outbox WHERE seq=?',row.seq);
   }
   return {synced:true,pending:this.store.get('SELECT COUNT(*) AS n FROM cf_outbox').n};
  }catch{return {synced:false,pending:this.store.get('SELECT COUNT(*) AS n FROM cf_outbox').n};}finally{this.flushing=null;}})();return this.flushing;}
 async fetch(request){const url=new URL(request.url),path=url.pathname,method=request.method,requestId=crypto.randomUUID();
  try{
   // Binding-only maintenance. Worker never routes these paths. No network provisioning or recovery endpoint.
   if(path.startsWith('/__')){if(this.env.MODE!=='local')fail(403,'LOCAL_ONLY','로컬 검사만 허용됩니다.');
    if(path==='/__provision'&&method==='POST'){const data=await request.json();if(this.store.users().length)fail(409,'ALREADY_PROVISIONED','이미 준비된 저장소입니다.');keys(data,['users']);if(!Array.isArray(data.users)||data.users.length<3||data.users.length>20)fail(422,'INVALID_USERS','합성 사용자만 준비합니다.');const users=this.store.tx(()=>data.users.map(u=>this.store.addUser(u.handle,u.nickname,u.credentials)));this.store.tx(()=>this.store.enqueue());return Response.json({users});}
    if(path==='/__backup'){await this.ctx.storage.sync();return Response.json(this.store.exportSnapshot());}
    if(path==='/__restore'&&method==='POST'){const value=this.store.restore(await request.json());return Response.json(value);}
    if(path==='/__flush'){return Response.json(await this.flush());}
    if(path==='/__rebuild-meta'&&method==='POST'){await this.flush();await this.env.META.prepare('DELETE FROM workspace_projection WHERE workspace=?').bind(this.ctx.id.toString()).run();this.store.tx(()=>this.store.enqueue());return Response.json(await this.flush());}
    if(path==='/__metrics'){return Response.json({usage:this.store.all('SELECT * FROM cf_usage'),pending:this.store.get('SELECT COUNT(*) AS n FROM cf_outbox').n,bytes:this.store.sql.databaseSize});}
    fail(404,'NOT_FOUND','허용되지 않은 검사입니다.');
   }
   if(!localOrigin(url,this.env))fail(400,'TRANSPORT_FORBIDDEN','허용된 주소를 사용해주세요.');
   if(request.headers.has('origin')&&request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_FORBIDDEN','같은 앱에서 요청해주세요.');
   if(ASSETS.has(path)&&method==='GET'&&!url.search){const asset=await this.env.ASSETS.fetch(request);return this.decorate(asset,url);}
   if(path==='/health'&&method==='GET')return this.json(200,{status:'ok',mode:'cloudflare-local-synthetic',schemaVersion:'cf-v1',externalApiEnabled:false},url);
   if(method!=='GET'&&request.headers.get('origin')!==url.origin)fail(403,'ORIGIN_FORBIDDEN','같은 앱에서 요청해주세요.');
   if(path==='/api/login'&&method==='POST'){
    this.store.tx(()=>{this.store.take('login:all',20);this.store.take('login:network:'+digest(request.headers.get('CF-Connecting-IP')||'loopback'),5);});
    if(this.pendingLogins>=2)fail(429,'AUTH_BUSY','잠시 후 로그인해주세요.');const data=await body(request);keys(data,['handle','password']);const handle=text(data.handle,32,'로그인 이름');if(typeof data.password!=='string'||data.password.length>128)fail(401,'LOGIN_FAILED','로그인 정보를 확인해주세요.');
    this.store.take('login:handle:'+digest(handle),5);const epoch=this.store.get("SELECT value FROM cf_meta WHERE key='epoch'").value;const record=this.store.credential(handle);this.pendingLogins++;let matched;try{matched=await passwordMatches(data.password,record);}finally{this.pendingLogins--;}
    if(!matched||epoch!==this.store.get("SELECT value FROM cf_meta WHERE key='epoch'").value)fail(401,'LOGIN_FAILED','로그인 정보를 확인해주세요.');
    const raw=token(),hash=digest(raw),user=this.store.user(record.id);const revoked=this.store.event(()=>{const old=rawCookie(request),hashes=old?[digest(old)]:[];if(old)this.store.dropSession(digest(old));return [...hashes,...this.store.addSession(hash,user.id,{idleMs:Number(this.env.SESSION_IDLE_MS||900000),absoluteMs:Number(this.env.SESSION_ABSOLUTE_MS||28800000)})];},this.options());for(const h of revoked)this.closeHash(h);
    return this.json(200,{user,csrf:digest('csrf:'+raw)},url,{'Set-Cookie':COOKIE+'='+raw+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+(url.protocol==='https:'?'; Secure':'')});
   }
   const session=this.auth(request,false),userId=session.user.id;this.store.tx(()=>this.store.take('request:'+userId,120));
   if(path==='/ws'&&method==='GET'){
    if(request.headers.get('origin')!==url.origin||request.headers.get('upgrade')?.toLowerCase()!=='websocket')fail(403,'ORIGIN_FORBIDDEN','같은 앱 연결만 허용됩니다.');
    if(url.searchParams.getAll('roomId').length!==1||[...url.searchParams.keys()].some(k=>k!=='roomId'))fail(422,'INVALID_SOCKET','연결 항목을 확인해주세요.');const roomId=uuid(url.searchParams.get('roomId'));this.store.requireMember(roomId,userId);this.store.take('ws:'+userId,10);
    const sockets=this.ctx.getWebSockets();if(sockets.length>=24||sockets.filter(ws=>ws.deserializeAttachment()?.userId===userId).length>=3)fail(429,'SOCKET_LIMIT','연결 수가 많습니다.');
    this.store.event(()=>this.auth(request),this.options());const [client,server]=Object.values(new WebSocketPair());server.serializeAttachment({userId,roomId,hash:session.hash});this.ctx.acceptWebSocket(server);server.send(JSON.stringify({type:'ready',roomId,userId}));return new Response(null,{status:101,webSocket:client});
   }
   if(!path.startsWith('/api/'))fail(404,'NOT_FOUND','화면을 찾을 수 없습니다.');
   if(method!=='GET'&&!equal(request.headers.get('x-csrf-token'),session.csrf))fail(403,'CSRF_FORBIDDEN','요청 확인 정보가 필요합니다.');
   if(url.search&&!(method==='GET'&&/^\/api\/rooms\/[^/]+\/messages$/.test(path)&&[...url.searchParams.keys()].every(k=>k==='after')&&url.searchParams.getAll('after').length===1))fail(422,'QUERY_FORBIDDEN','허용되지 않은 조회 항목입니다.');
   const data=method==='GET'?null:await body(request);this.auth(request,false);let notifyRoom=null,logout=false;
   const result=this.store.event(()=>{this.auth(request);const s=this.store;let status=200,value;
    if(path==='/api/session'&&method==='GET')value={user:session.user,csrf:session.csrf};
    else if(path==='/api/logout'&&method==='POST'){keys(data,[]);s.dropSession(session.hash);logout=true;value={loggedOut:true};}
    else if(path==='/api/admin/status'&&method==='GET'){this.operator(userId);value={status:'ok',mode:'cloudflare-local',schemaVersion:'cf-v1',sockets:this.ctx.getWebSockets().length,metadataPending:s.get('SELECT COUNT(*) AS n FROM cf_outbox').n,externalApiEnabled:false};}
    else if(path==='/api/admin/revoke'&&method==='POST'){this.operator(userId);keys(data,['userId']);uuid(data.userId);s.run('DELETE FROM sessions WHERE user_id=?',data.userId);value={revoked:true};}
    else if(path==='/api/users'&&method==='GET')value={users:s.users()};
    else if(path==='/api/rooms'&&method==='GET')value={rooms:s.rooms(userId)};
    else if(path==='/api/rooms'&&method==='POST'){keys(data,['kind','title','memberIds']);value={room:s.createRoom(userId,data)};status=201;}
    else if(path==='/api/promises'&&method==='GET')value={promises:s.promises(userId)};
    else if(path==='/api/invites'&&method==='POST'){keys(data,['requestId']);value={invite:s.invite(userId,uuid(data.requestId))};status=201;}
    else{const rm=path.match(/^\/api\/rooms\/([^/]+)(?:\/(members|messages|receipts|proposals|reset))?$/),pr=path.match(/^\/api\/proposals\/([^/]+)\/(edit|ignore|confirm)$/),pm=path.match(/^\/api\/promises\/([^/]+)(?:\/(rsvp|review|apply))?$/);
     if(rm){const id=uuid(rm[1]),action=rm[2];s.requireMember(id,userId);
      if(!action&&method==='GET')value=s.snapshot(id,userId);
      else if(action==='messages'&&method==='GET'){const after=url.searchParams.get('after')||'0';if(!/^\d+$/.test(after))fail(422,'INVALID_CURSOR','조회 위치를 확인해주세요.');value={messages:s.messages(id,userId,{after:Number(after)})};}
      else if(action==='messages'&&method==='POST'){s.take('messages:'+userId,30);keys(data,['clientMessageId','text']);value=s.send(id,userId,data.clientMessageId,data.text);status=value.duplicate?200:201;notifyRoom=id;}
      else if(action==='receipts'&&method==='POST'){keys(data,['messageIds']);value=s.receive(id,userId,data.messageIds);if(value.changed)notifyRoom=id;}
      else if(action==='members'&&method==='POST'){keys(data,['userId','active']);if(typeof data.active!=='boolean')fail(422,'INVALID_ACTIVE','참가 상태를 확인해주세요.');value={members:s.manageMember(id,userId,data.userId,data.active)};notifyRoom=id;}
      else if(action==='proposals'&&method==='POST'){value={proposal:s.propose(id,userId,data)};notifyRoom=id;status=201;}
      else if(action==='reset'&&method==='POST'){s.owner(id,userId);fail(409,'RESET_DISABLED','대화 초기화는 비활성화되어 있습니다.');}
     }else if(pr&&method==='POST'){const id=uuid(pr[1]),action=pr[2];
      if(action==='edit'){keys(data,['expectedVersion','payload']);value={proposal:s.editProposal(id,userId,data.expectedVersion,data.payload)};}
      else if(action==='ignore'){keys(data,['expectedVersion']);value={proposal:s.ignoreProposal(id,userId,data.expectedVersion)};}
      else{keys(data,['expectedVersion','decision']);value={promise:s.confirm(id,userId,data.expectedVersion,data.decision)};}notifyRoom=s.proposal(id,userId).room_id;
     }else if(pm){const id=uuid(pm[1]),action=pm[2],promise=s.promise(id,userId);
      if(!action&&method==='GET')value={promise:s.promiseView(promise,userId)};
      else if(method==='POST'){
       if(action==='rsvp'){keys(data,['response']);value={promise:s.rsvp(id,userId,data.response)};}
       else if(action==='review'){keys(data,['kind','expectedVersion','payload'],['kind','expectedVersion']);if(data.kind==='cancel'&&Object.hasOwn(data,'payload'))fail(422,'INVALID_FIELDS','취소에 변경을 넣을 수 없습니다.');value={review:s.review(id,userId,data.kind,data.expectedVersion,data.payload)};}
       else if(action==='apply'){keys(data,['reviewId','decision']);value={promise:s.apply(id,userId,data.reviewId,data.decision)};}notifyRoom=promise.room_id;
      }
     }
    }
    if(value===undefined)fail(404,'NOT_FOUND','허용되지 않은 작업입니다.');
    if(method!=='GET'&&path!=='/api/logout')s.enqueue();return {status,value};
   },this.options());
   if(logout)this.closeHash(session.hash);if(path==='/api/admin/revoke')for(const ws of this.ctx.getWebSockets())if(!this.valid(ws))ws.close(1008,'Session revoked');if(notifyRoom)this.notify(notifyRoom);
   if(method!=='GET')this.ctx.waitUntil(this.flush());
   return this.json(result.status,result.value,url,logout?{'Set-Cookie':COOKIE+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(url.protocol==='https:'?'; Secure':'')}:{});
  }catch(error){const status=error instanceof Fault?error.status:503,code=error instanceof Fault?error.code:'STORAGE_UNAVAILABLE';return this.json(status,{error:{code,message:error instanceof Fault?error.message:'저장소를 확인한 후 다시 시도해주세요.'},requestId},url,status===503?{'Retry-After':'60'}:{});}
 }
 operator(userId){if(userId!==this.store.get('SELECT id FROM users ORDER BY created_at,rowid LIMIT 1')?.id)fail(403,'OPERATOR_REQUIRED','테스트 운영자 권한이 필요합니다.');}
 webSocketMessage(ws,message){try{const a=this.valid(ws);if(!a)throw new Error('revoked');if(typeof message!=='string'||new TextEncoder().encode(message).length>4096)throw new Error('size');this.store.take('ws-message:'+a.userId,10);const data=JSON.parse(message);keys(data,['type']);if(data.type!=='ping')throw new Error('frame');this.store.event(()=>{if(!this.valid(ws))throw new Error('revoked');},this.options());ws.send(JSON.stringify({type:'pong'}));}catch{ws.close(1008,'Invalid or unauthorized frame');}}
 webSocketClose(ws,code){try{ws.close(code===1006?1000:code,'Closed');}catch{}}
 webSocketError(ws){try{ws.close(1011,'Reconnect');}catch{}}
 decorate(response,url){const headers=new Headers(response.headers);for(const [key,value] of Object.entries({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' "+url.origin.replace(/^http:/,'ws:').replace(/^https:/,'wss:')+"; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"}))headers.set(key,value);return new Response(response.body,{status:response.status,headers});}
 json(status,value,url,extra={}){return this.decorate(Response.json(value,{status,headers:extra}),url);}
}

import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {Store} from './store.mjs';
import {Fault,fail,keys,text,uuid,digest,token,equal,passwordMatches,Limiter} from './security.mjs';
export const COOKIE='pb_mvp_session';
const aliases=['127.0.0.1','localhost','a.localhost','b.localhost','c.localhost'];
const assets=new Map([['/','index.html'],['/index.html','index.html'],['/app.mjs','app.mjs'],['/styles.css','styles.css'],['/icon.svg','icon.svg']]);
const mime={html:'text/html; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml'};
function cookieToken(req){const parts=(req.headers.cookie||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(COOKIE+'='));if(parts.length!==1)return null;const value=parts[0].slice(COOKIE.length+1);return /^[a-f0-9]{64}$/.test(value)?value:null;}
function body(req){return new Promise((resolve,reject)=>{let size=0,chunks=[],failed=false;req.on('data',chunk=>{if(failed)return;size+=chunk.length;if(size>16384){failed=true;chunks=[];reject(new Fault(413,'BODY_TOO_LARGE','요청 크기가 너무 큽니다.'));}else chunks.push(chunk);});req.on('end',()=>{if(failed)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Fault(400,'INVALID_JSON','JSON 요청을 확인해주세요.'));}});req.on('error',()=>reject(new Fault(400,'REQUEST_ABORTED','요청이 중단됐습니다.')));});}
export function createMVP({dbFile,port=0,host='127.0.0.1',now=Date.now,limits={},sessionIdleMs=900000,sessionAbsoluteMs=28800000,heartbeatMs=15000,externalApi=false}={}) {
 if(host!=='127.0.0.1'||externalApi!==false)throw new Error('Only an isolated loopback server with external APIs disabled is permitted');
 if(!Number.isInteger(port)||port<0||port>65535||sessionIdleMs<1||sessionAbsoluteMs<1)throw new Error('Invalid local server configuration');
 const counts={login:5,requests:120,messages:30,ws:10,...limits};
 for(const value of Object.values(counts))if(!Number.isInteger(value)||value<1||value>1000)throw new Error('Rate limits cannot be disabled');
 const store=new Store(dbFile,{now}),limiter=new Limiter({now});
 const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});let pendingLogins=0;
 const currentPort=()=>server.address()?.port||port;
 const originFor=req=>{const authority=req.headers.host;if(typeof authority!=='string'||!aliases.some(alias=>authority===alias+':'+currentPort()))fail(400,'HOST_FORBIDDEN','허용된 로컬 주소를 사용해주세요.');return 'http://'+authority;};
 const originCheck=req=>{const expected=originFor(req);if(req.headers.origin!==expected)fail(403,'ORIGIN_FORBIDDEN','같은 로컬 앱에서 요청해주세요.');};
 const auth=(req,touch=true)=>{const raw=cookieToken(req);const session=raw?store.session(digest(raw),{idleMs:sessionIdleMs,touch}):null;if(!session)fail(401,'UNAUTHENTICATED','로그인이 필요합니다.');return {...session,csrf:digest('csrf:'+raw)};};
 const authorizedBody=async req=>{const data=await body(req);auth(req,false);return data;};
 const closeHash=hash=>{for(const ws of wss.clients)if(ws.sessionHash===hash)ws.close(1008,'Session revoked');};
 const socketAllowed=ws=>Boolean(store.session(ws.sessionHash,{idleMs:sessionIdleMs,touch:false})&&store.member(ws.roomId,ws.userId));
 const notify=roomId=>{for(const ws of wss.clients){if(!socketAllowed(ws)){ws.close(1008,'Access revoked');continue;}if(ws.roomId===roomId&&ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>65536)ws.terminate();else ws.send(JSON.stringify({type:'room.changed',roomId}));}}};
 const headers=(res,req)=>{const origin=originFor(req);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' "+origin.replace('http:','ws:')+"; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");};
 const json=(res,status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));};
 const server=createServer({maxHeaderSize:8192},async(req,res)=>{
  const requestId=randomUUID();
  try {
   headers(res,req);const url=new URL(req.url,originFor(req)),path=url.pathname,method=req.method;
   if(req.headers.origin&&req.headers.origin!==originFor(req))fail(403,'ORIGIN_FORBIDDEN','요청 출처를 확인해주세요.');
   if(method==='GET'&&assets.has(path)&&!url.search){res.setHeader('Content-Type',mime[assets.get(path).split('.').at(-1)]);res.end(readFileSync(new URL('./client/'+assets.get(path),import.meta.url)));return;}
   if(path==='/health'&&method==='GET'){json(res,200,{status:'ok',mode:'isolated-synthetic-mvp',externalApiEnabled:false});return;}
   if(!path.startsWith('/api/'))fail(404,'NOT_FOUND','화면을 찾을 수 없습니다.');
   if(method!=='GET'){originCheck(req);if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')fail(415,'JSON_REQUIRED','JSON 요청만 허용합니다.');}
   if(path==='/api/login'&&method==='POST'){
    limiter.take('login:'+req.socket.remoteAddress,counts.login);if(pendingLogins>=4)fail(429,'AUTH_BUSY','잠시 후 로그인해주세요.');
    const data=await body(req);keys(data,['handle','password']);const handle=text(data.handle,32,'로그인 이름');if(typeof data.password!=='string'||data.password.length>128)fail(401,'LOGIN_FAILED','로그인 정보를 확인해주세요.');
    pendingLogins++;let user;try{const record=store.credential(handle);if(await passwordMatches(data.password,record))user=store.user(record.id);}finally{pendingLogins--;}
    if(!user)fail(401,'LOGIN_FAILED','로그인 정보를 확인해주세요.');
    const old=cookieToken(req);if(old){store.dropSession(digest(old));closeHash(digest(old));}
    const raw=token(),hash=digest(raw);for(const oldHash of store.addSession(hash,user.id,{idleMs:sessionIdleMs,absoluteMs:sessionAbsoluteMs}))closeHash(oldHash);
    res.setHeader('Set-Cookie',COOKIE+'='+raw+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+Math.floor(sessionAbsoluteMs/1000));json(res,200,{user,csrf:digest('csrf:'+raw)});return;
   }
   const session=auth(req),userId=session.user.id;
   limiter.take('request:'+userId,counts.requests);
   if(method!=='GET'&&!equal(req.headers['x-csrf-token'],session.csrf))fail(403,'CSRF_FORBIDDEN','요청 확인 정보가 필요합니다.');
   if(url.search&&!(method==='GET'&&/^\/api\/rooms\/[^/]+\/messages$/.test(path)&&[...url.searchParams.keys()].every(key=>key==='after')&&url.searchParams.getAll('after').length===1))fail(422,'QUERY_FORBIDDEN','허용되지 않은 조회 항목입니다.');
   if(path==='/api/session'&&method==='GET'){json(res,200,{user:session.user,csrf:session.csrf});return;}
   if(path==='/api/logout'&&method==='POST'){keys(await authorizedBody(req),[]);store.dropSession(session.hash);closeHash(session.hash);res.setHeader('Set-Cookie',COOKIE+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(res,200,{loggedOut:true});return;}
   if(path==='/api/users'&&method==='GET'){json(res,200,{users:store.users()});return;}
   if(path==='/api/rooms'&&method==='GET'){json(res,200,{rooms:store.rooms(userId)});return;}
   if(path==='/api/rooms'&&method==='POST'){const data=await authorizedBody(req);keys(data,['kind','title','memberIds']);const room=store.createRoom(userId,data);json(res,201,{room});return;}
   if(path==='/api/promises'&&method==='GET'){json(res,200,{promises:store.promises(userId)});return;}
   const roomMatch=path.match(/^\/api\/rooms\/([^/]+)(?:\/(members|messages|receipts|proposals|reset))?$/);
   if(roomMatch){const roomId=uuid(roomMatch[1]),action=roomMatch[2];store.requireMember(roomId,userId);
    if(!action&&method==='GET'){json(res,200,store.snapshot(roomId,userId));return;}
    if(action==='messages'&&method==='GET'){const cursor=url.searchParams.get('after')||'0';if(!/^\d+$/.test(cursor))fail(422,'INVALID_CURSOR','조회 위치를 확인해주세요.');json(res,200,{messages:store.messages(roomId,userId,{after:Number(cursor)})});return;}
    if(action==='messages'&&method==='POST'){limiter.take('messages:'+userId,counts.messages);const data=await authorizedBody(req);keys(data,['clientMessageId','text']);const result=store.send(roomId,userId,data.clientMessageId,data.text);notify(roomId);json(res,result.duplicate?200:201,result);return;}
    if(action==='receipts'&&method==='POST'){const data=await authorizedBody(req);keys(data,['messageIds']);const result=store.receive(roomId,userId,data.messageIds);if(result.changed)notify(roomId);json(res,200,result);return;}
    if(action==='members'&&method==='POST'){const data=await authorizedBody(req);keys(data,['userId','active']);if(typeof data.active!=='boolean')fail(422,'INVALID_ACTIVE','참가 상태를 확인해주세요.');const members=store.manageMember(roomId,userId,data.userId,data.active);notify(roomId);json(res,200,{members});return;}
    if(action==='proposals'&&method==='POST'){const data=await authorizedBody(req);const proposal=store.propose(roomId,userId,data);notify(roomId);json(res,201,{proposal});return;}
    if(action==='reset'&&method==='POST'){store.owner(roomId,userId);fail(409,'RESET_DISABLED','MVP에서 대화 삭제·초기화는 비활성화되어 있습니다.');}
   }
   const proposalMatch=path.match(/^\/api\/proposals\/([^/]+)\/(edit|ignore|confirm)$/);
   if(proposalMatch&&method==='POST'){const id=uuid(proposalMatch[1]),action=proposalMatch[2],data=await authorizedBody(req);let result;
    if(action==='edit'){keys(data,['expectedVersion','payload']);result={proposal:store.editProposal(id,userId,data.expectedVersion,data.payload)};}
    else if(action==='ignore'){keys(data,['expectedVersion']);result={proposal:store.ignoreProposal(id,userId,data.expectedVersion)};}
    else{keys(data,['expectedVersion','decision']);result={promise:store.confirm(id,userId,data.expectedVersion,data.decision)};}
    const roomId=store.proposal(id,userId).room_id;notify(roomId);json(res,200,result);return;
   }
   const promiseMatch=path.match(/^\/api\/promises\/([^/]+)(?:\/(rsvp|review|apply))?$/);
   if(promiseMatch){const id=uuid(promiseMatch[1]),action=promiseMatch[2];const promise=store.promise(id,userId);
    if(!action&&method==='GET'){json(res,200,{promise:store.promiseView(promise)});return;}
    if(method==='POST'){const data=await authorizedBody(req);let result;
     if(action==='rsvp'){keys(data,['response']);result={promise:store.rsvp(id,userId,data.response)};}
     else if(action==='review'){keys(data,['kind','expectedVersion','payload'],['kind','expectedVersion']);if(data.kind==='cancel'&&Object.hasOwn(data,'payload'))fail(422,'INVALID_FIELDS','취소에는 변경 항목을 넣을 수 없습니다.');result={review:store.review(id,userId,data.kind,data.expectedVersion,data.payload)};}
     else if(action==='apply'){keys(data,['reviewId','decision']);result={promise:store.apply(id,userId,data.reviewId,data.decision)};}
     else fail(404,'NOT_FOUND','허용된 작업이 아닙니다.');
     notify(promise.room_id);json(res,200,result);return;
    }
   }
   fail(404,'NOT_FOUND','허용된 작업이 아닙니다.');
  }catch(error){if(res.headersSent){res.end();return;}if(error instanceof Fault){if(error.status===413)res.setHeader('Connection','close');json(res,error.status,{error:{code:error.code,message:error.message},requestId});}else{console.error(JSON.stringify({event:'request.failed',requestId,code:'INTERNAL'}));json(res,500,{error:{code:'INTERNAL',message:'서버에서 처리하지 못했습니다.'},requestId});}}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 server.on('upgrade',(req,socket,head)=>{
  socket.on('error',()=>{});
  try{originCheck(req);const session=auth(req,false),url=new URL(req.url,originFor(req));if(url.pathname!=='/ws'||url.searchParams.getAll('roomId').length!==1||[...url.searchParams.keys()].some(key=>key!=='roomId'))fail(422,'INVALID_SOCKET','WebSocket 요청을 확인해주세요.');
   const roomId=uuid(url.searchParams.get('roomId'));store.requireMember(roomId,session.user.id);limiter.take('ws:'+session.user.id,counts.ws);if([...wss.clients].filter(ws=>ws.userId===session.user.id).length>=3||wss.clients.size>=24)fail(429,'SOCKET_LIMIT','연결 수가 많습니다.');
   wss.handleUpgrade(req,socket,head,ws=>{ws.sessionHash=session.hash;ws.userId=session.user.id;ws.roomId=roomId;ws.alive=true;ws.on('error',()=>{});ws.on('pong',()=>{ws.alive=true;});
    ws.on('message',(raw,binary)=>{try{if(!socketAllowed(ws))fail(401,'UNAUTHENTICATED','로그인이 필요합니다.');limiter.take('ws-message:'+ws.userId,10);if(binary)fail(422,'INVALID_SOCKET','JSON 확인 요청만 허용합니다.');const data=JSON.parse(raw.toString());keys(data,['type']);if(data.type!=='ping')fail(422,'INVALID_SOCKET','메시지 전송은 인증된 HTTP API를 사용해주세요.');ws.send(JSON.stringify({type:'pong'}));}catch{ws.close(1008,'Invalid or unauthorized frame');}});
    ws.send(JSON.stringify({type:'ready',roomId,userId:session.user.id}));
   });
  }catch(error){const status=error instanceof Fault?error.status:500;socket.write('HTTP/1.1 '+status+' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');socket.destroy();}
 });
 const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!socketAllowed(ws)||!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},heartbeatMs);heartbeat.unref();
 return {store,server,wss,async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});return {port:currentPort(),url:'http://127.0.0.1:'+currentPort()};},async close(){clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));store.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dbFile=process.env.MVP_SQLITE_FILE;if(!dbFile)throw new Error('MVP_SQLITE_FILE must explicitly name the isolated test database');
 if(process.env.MVP_EXTERNAL_API&&process.env.MVP_EXTERNAL_API!=='off')throw new Error('External API mode must remain off');
 const app=createMVP({dbFile,port:Number(process.env.MVP_PORT||4174),host:process.env.MVP_HOST||'127.0.0.1'});
 await app.listen();console.log(JSON.stringify({event:'mvp.ready',port:app.server.address().port,mode:'isolated-synthetic',externalApiEnabled:false}));
 let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();process.exit(0);};process.on('SIGINT',close);process.on('SIGTERM',close);
}

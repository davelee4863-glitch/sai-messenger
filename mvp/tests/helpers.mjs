import {mkdtempSync,rmSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {WebSocket} from 'ws';
import {createMVP} from '../server.mjs';
import {passwordHash} from '../security.mjs';
export const sample={title:'합성 모임',date:'2026-10-24',time:'14:00',endTime:'15:00',place:'합성 카페',notes:'테스트 후보 · 유료 AI 호출 없음'};
export async function fixture(t,options={}) {
 const dir=mkdtempSync(resolve(tmpdir(),'promise-box-core-')),dbFile=resolve(dir,'data/test.sqlite');
 const app=createMVP({dbFile,limits:{login:100,requests:1000,messages:100,ws:100},...options});
 const accounts=[];for(const handle of ['user-a','user-b','user-c','user-d']){const password=randomBytes(24).toString('base64url');accounts.push({...app.store.addUser(handle,'합성 '+handle.slice(-1).toUpperCase(),await passwordHash(password)),password});}
 const {url}=await app.listen();let closed=false;
 const close=async()=>{if(!closed){closed=true;await app.close();}};
 t.after(async()=>{await close();if(!resolve(dir).startsWith(resolve(tmpdir())+sep))throw new Error('Fixture cleanup outside expected temp directory');rmSync(dir,{recursive:true,force:true});});
 return {app,dir,dbFile,url,accounts,close};
}
export async function request(f,path,{user,method='GET',data,headers={}}={}) {
 const configured={Origin:f.url,...headers};if(user){configured.Cookie=user.cookie;if(method!=='GET')configured['X-CSRF-Token']=user.csrf;}
 if(method!=='GET')configured['Content-Type']='application/json';
 const response=await fetch(f.url+path,{method,headers:configured,body:method==='GET'?undefined:JSON.stringify(data??{})});
 return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
}
export async function login(f,index=0){const account=f.accounts[index],result=await request(f,'/api/login',{method:'POST',data:{handle:account.handle,password:account.password}});if(result.status!==200)throw new Error('Synthetic login failed with status '+result.status);return {id:account.id,nickname:account.nickname,cookie:result.cookie.split(';')[0],csrf:result.body.csrf,attributes:result.cookie};}
export async function room(f,owner,users,kind=users.length===1?'direct':'group'){const result=await request(f,'/api/rooms',{user:owner,method:'POST',data:{kind,title:'합성 '+kind,memberIds:users.map(user=>user.id)}});if(result.status!==201)throw new Error('Room creation failed with status '+result.status);return result.body.room;}
export function socket(f,user,roomId,{origin=f.url,extraQuery=''}={}) {
 return new Promise((resolve,reject)=>{const ws=new WebSocket(f.url.replace('http:','ws:')+'/ws?roomId='+roomId+extraQuery,{headers:{Origin:origin,...(user?{Cookie:user.cookie}:{})}});let done=false;
  ws.once('unexpected-response',(_req,res)=>{done=true;res.resume();reject(Object.assign(new Error('Upgrade rejected'),{status:res.statusCode}));});ws.once('error',error=>{if(!done)reject(error);});ws.once('message',raw=>{const frame=JSON.parse(raw.toString());if(frame.type==='ready'){done=true;resolve(ws);}else reject(new Error('Unexpected initial socket frame'));});
 });
}
export function nextFrame(ws,type='room.changed'){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',listen);reject(new Error('Expected socket event not received'));},3000);function listen(raw){const frame=JSON.parse(raw.toString());if(frame.type===type){clearTimeout(timer);ws.off('message',listen);resolve(frame);}}ws.on('message',listen);});}

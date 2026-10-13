import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {passwordHash} from '../../mvp/security.mjs';
import {runtime,maintenance} from '../runtime.mjs';
export const sample={title:'우리의 따뜻한 약속',date:'2026-10-20',time:'14:00',endTime:'15:00',place:'합성 크림 카페',notes:'합성 테스트만'};
export const passwordFor=i=>'Synthetic-CF-only-2026!'+i;
export async function fixture(t,options={}){const persist=await mkdtemp(resolve(tmpdir(),'promise-box-cf-'));const f={mf:null,persist,origin:options.origin||'http://localhost:8787',options};
 t.after(async()=>{await f.mf?.dispose();const absolute=resolve(persist);if(!absolute.startsWith(resolve(tmpdir(),'promise-box-cf-')))throw new Error('Cleanup boundary rejected');await rm(absolute,{recursive:true,force:true});});
 const mf=f.mf=await runtime({persist,...options});
 const users=[];for(let i=0;i<4;i++)users.push({handle:'synthetic-'+i,nickname:'합성 사용자 '+String.fromCharCode(65+i),credentials:await passwordHash(passwordFor(i))});
 const provision=await maintenance(mf,'__provision',{users});if(provision.status!==200)throw new Error('Provision failed: '+await provision.text());f.users=(await provision.json()).users;
 f.restart=async (bindings={},changes={})=>{await f.mf.dispose();f.mf=await runtime({persist,...options,...changes,bindings:{...options.bindings,...bindings}});if(changes.origin)f.origin=changes.origin;};
 return f;}
export async function request(f,path,{user,method='GET',data,headers={}}={}){const h={...headers};if(user){h.Cookie=user.cookie;h['x-csrf-token']=user.csrf;}if(method!=='GET'){h.Origin??=f.origin;h['Content-Type']??='application/json';}
 const response=await f.mf.dispatchFetch(f.origin+path,{method,headers:h,body:data!==undefined?JSON.stringify(data):undefined});const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{throw new Error('Non-JSON local runtime response: '+response.status+' '+raw);}return {status:response.status,body,headers:response.headers};}
export async function login(f,i=0){const r=await request(f,'/api/login',{method:'POST',data:{handle:'synthetic-'+i,password:passwordFor(i)}});if(r.status!==200)throw new Error('Login failed '+r.status+' '+JSON.stringify(r.body));return {...r.body.user,csrf:r.body.csrf,cookie:r.headers.get('Set-Cookie').split(';')[0]};}
export async function room(f,users){const r=await request(f,'/api/rooms',{user:users[0],method:'POST',data:{kind:users.length===2?'direct':'group',title:'합성 약속함',memberIds:users.slice(1).map(u=>u.id)}});if(r.status!==201)throw new Error('Room failed '+JSON.stringify(r.body));return r.body.room;}
export function frame(ws){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WebSocket timed out')),5000);const handler=e=>{clearTimeout(timer);ws.removeEventListener('message',handler);resolve(JSON.parse(e.data));};ws.addEventListener('message',handler);});}
export async function socket(f,user,roomId){const r=await f.mf.dispatchFetch(f.origin+'/ws?roomId='+roomId,{headers:{Upgrade:'websocket',Origin:f.origin,Cookie:user.cookie}});if(r.status!==101)throw new Error('Socket denied '+r.status+' '+await r.text());const ws=r.webSocket,ready=frame(ws);ws.accept();await ready;return ws;}
export {runtime,maintenance};

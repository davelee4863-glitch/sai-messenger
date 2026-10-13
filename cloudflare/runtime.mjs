import {Miniflare,Log,LogLevel} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {bundle} from './build.mjs';
import {configuration} from './config.mjs';
import {acquireWriter} from '../mvp/writer-lock.mjs';
export async function runtime({persist,port=0,origin='http://localhost:8787',bindings={}}={}){
 if(!persist||!['localhost','127.0.0.1','a.localhost','b.localhost','c.localhost'].includes(new URL(origin).hostname))throw new Error('Explicit isolated local persistence and origin required');
 configuration(bindings);const release=acquireWriter(resolve(persist,'workspace.sqlite'),{mode:'local',reclaimDeadLocal:true});let mf;
 try{mf=new Miniflare({name:'promise-box-local-only',rootPath:fileURLToPath(new URL('../',import.meta.url)),modules:true,script:await bundle(),compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port,cf:false,
  bindings:{MODE:'local',ORIGIN:origin,...bindings},durableObjects:{WORKSPACE:{className:'Workspace',useSQLite:true}},durableObjectsPersist:resolve(persist,'do'),d1Databases:{META:'synthetic-metadata-v1'},d1Persist:resolve(persist,'d1'),
  assets:{workerName:'promise-box-local-only',directory:fileURLToPath(new URL('../mvp/client/',import.meta.url)),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},
  outboundService:()=>new Response('External network disabled',{status:403}),log:new Log(LogLevel.ERROR),unsafeProxySharedSecret:undefined});await mf.ready;
  const dispose=mf.dispose.bind(mf);let disposed=false;mf.dispose=async()=>{if(disposed)return;disposed=true;try{await dispose();}finally{release();}};return mf;
 }catch(error){try{await mf?.dispose();}finally{release();}throw error;}
}
export async function maintenance(mf,path,data){const ns=await mf.getDurableObjectNamespace('WORKSPACE'),stub=ns.get(ns.idFromName('synthetic-private-v1'));return stub.fetch('http://binding-only/'+path,{method:data?'POST':'GET',body:data?JSON.stringify(data):undefined});}

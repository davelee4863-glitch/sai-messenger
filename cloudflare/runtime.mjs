import {Miniflare,Log,LogLevel} from 'miniflare';
import {assertHostRuntime} from './host-security.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {bundle} from './build.mjs';
import {acquireWriter} from '../mvp/writer-lock.mjs';
import {runtimeOptions,ownPersistence} from './local-isolation.mjs';
import {APP_ID,NAMESPACE,BINDINGS,WORKER_NAME,WORKSPACE_NAME,D1_ID,DO_CLASS} from './isolation-identity.mjs';
export async function runtime(options={}){
 assertHostRuntime();
 const {persist,port,origin,bindings}=runtimeOptions(options);ownPersistence(persist);
 const release=acquireWriter(resolve(persist,'workspace.sqlite'),{mode:'local',reclaimDeadLocal:true});let mf;
 try{mf=new Miniflare({name:WORKER_NAME,rootPath:fileURLToPath(new URL('../',import.meta.url)),modules:true,script:await bundle(),compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port,cf:false,
  bindings:{MODE:'local',ORIGIN:origin,PBX_CF_APP_ID:APP_ID,PBX_CF_NAMESPACE:NAMESPACE,...bindings},durableObjects:{[BINDINGS.workspace]:{className:DO_CLASS,useSQLite:true}},durableObjectsPersist:resolve(persist,'do'),d1Databases:{[BINDINGS.metadata]:D1_ID},d1Persist:resolve(persist,'d1'),
  assets:{workerName:WORKER_NAME,directory:fileURLToPath(new URL('../mvp/client/',import.meta.url)),binding:BINDINGS.assets,routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:true}},
  outboundService:()=>new Response('External network disabled',{status:403}),log:new Log(LogLevel.ERROR),unsafeProxySharedSecret:undefined});await mf.ready;
  const dispose=mf.dispose.bind(mf);let disposed=false;mf.dispose=async()=>{if(disposed)return;disposed=true;try{await dispose();}finally{release();}};return mf;
 }catch(error){try{await mf?.dispose();}finally{release();}throw error;}
}
export async function maintenance(mf,path,data){const ns=await mf.getDurableObjectNamespace(BINDINGS.workspace),stub=ns.get(ns.idFromName(WORKSPACE_NAME));return stub.fetch('http://binding-only/'+path,{method:data?'POST':'GET',body:data?JSON.stringify(data):undefined});}

import {Workspace} from './workspace.mjs';
import {localOrigin,localHosts} from './origin.mjs';
export {Workspace};
export default {async fetch(request,env){
 const url=new URL(request.url);
 // This candidate is local-only. Cloud resource creation and exposure need a separate reviewed change.
 if(env.MODE!=='local'||!localHosts.includes(url.hostname))return new Response('Deployment is not approved',{status:503});
 if(!localOrigin(url,env))return new Response('Unexpected origin',{status:400});
 if(url.pathname.startsWith('/__'))return new Response('Not found',{status:404});
 try{const response=await env.WORKSPACE.get(env.WORKSPACE.idFromName('synthetic-private-v1')).fetch(request);return response;}catch{return Response.json({error:{code:'STORAGE_UNAVAILABLE',message:'저장소를 확인한 후 다시 시도해주세요.'}},{status:503,headers:{'Cache-Control':'no-store'}});}
}};

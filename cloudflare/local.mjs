import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {passwordHash,token} from '../mvp/security.mjs';
import {runtime,maintenance} from './runtime.mjs';
const dir=resolve(process.argv[2]||fileURLToPath(new URL('./.local/',import.meta.url)));
const port=Number(process.argv[3]||8787);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Local test port required');await mkdir(dir,{recursive:true,mode:0o700});
const mf=await runtime({persist:dir,port,origin:'http://localhost:'+port});await mf.ready;
const backup=await (await maintenance(mf,'__backup')).json();
if(!backup.tables.users.length){const users=[],credentials=[];for(let i=0;i<3;i++){const handle='cf-test-'+String.fromCharCode(97+i),password=token(),nickname='합성 사용자 '+String.fromCharCode(65+i);users.push({handle,nickname,credentials:await passwordHash(password)});credentials.push({handle,password,nickname});}
 const response=await maintenance(mf,'__provision',{users});if(response.status!==200)throw new Error('Local provisioning failed');await writeFile(resolve(dir,'test-credentials.json'),JSON.stringify(credentials,null,2),{flag:'wx',mode:0o600});}
console.log(JSON.stringify({event:'cloudflare.local.ready',url:'http://localhost:'+port,externalNetwork:false,cloudResourcesCreated:false}));
let closing=false;async function close(){if(closing)return;closing=true;await mf.dispose();process.exit(0);}process.on('SIGINT',close);process.on('SIGTERM',close);
process.stdin.on('data',data=>{if(data.toString().trim()==='stop')close();});process.stdin.resume();

import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validate} from './check.mjs';
const args={};
for(let x=2;x<process.argv.length;x+=2){
 const k=(process.argv[x]||'').replace(/^--/,'');
 if(!['id','severity','symptom','cause','prevention','test','evidence'].includes(k)||!process.argv[x]?.startsWith('--')||!process.argv[x+1]){console.error('Usage: --id --severity --symptom --cause --prevention --test --evidence');process.exit(2)}
 args[k]=process.argv[x+1].trim();
}
if(['id','severity','symptom','cause','prevention','test','evidence'].some(k=>!args[k])){console.error('All fields required');process.exit(2)}
if(/sk-[a-z0-9_-]{12,}|Bearer\s+[a-z0-9._-]+|(?:api[_-]?key|password|token)\s*[:=]\s*\S+/i.test(Object.values(args).join(' '))){console.error('Potential secret; redact');process.exit(2)}
const path=resolve(dirname(fileURLToPath(import.meta.url)),'incidents.json');
const data=JSON.parse(readFileSync(path,'utf8'));
data.incidents.push({id:args.id,loggedAt:new Date().toISOString(),severity:args.severity,status:'OPEN',symptom:args.symptom,rootCause:args.cause,prevention:args.prevention,regressionTest:args.test,evidence:args.evidence});
const errors=validate({schemaVersion:1,risks:[]},data);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
writeFileSync(path,JSON.stringify(data,null,2)+'\n');console.log('Recorded '+args.id);

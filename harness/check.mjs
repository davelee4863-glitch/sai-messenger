import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import {execFileSync} from 'node:child_process';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const validate=(risks,incidents)=>{
 const errors=[],ids=new Set();
 if(risks?.schemaVersion!==1||!Array.isArray(risks.risks))errors.push('Invalid risk inventory');
 else for(const r of risks.risks){
  if(!/^SAI-R[0-9]{3,}$/.test(r.id||'')||ids.has(r.id))errors.push('Bad or duplicate risk ID: '+r.id);
  ids.add(r.id);
  if(!['P0','P1','P2'].includes(r.priority)||!['OPEN','MITIGATING','VERIFIED'].includes(r.status))errors.push(r.id+' invalid status or priority');
  for(const k of ['title','evidence','prevention','regressionTest'])if(typeof r[k]!=='string'||!r[k].trim())errors.push(r.id+' missing '+k);
  if(r.status==='VERIFIED'&&(r.regressionTest==='PENDING'||!existsSync(resolve(ROOT,r.regressionTest))||!r.reviewedBy||!r.verificationEvidence))errors.push(r.id+' no verified regression/reviewer');
 }
 ids.clear();
 if(incidents?.schemaVersion!==1||!Array.isArray(incidents.incidents))errors.push('Invalid incident inventory');
 else for(const i of incidents.incidents){
  if(!/^SAI-INC-[0-9]{8}-[0-9]{2,}$/.test(i.id||'')||ids.has(i.id))errors.push('Bad or duplicate incident ID: '+i.id);
  ids.add(i.id);
  if(!['CRITICAL','HIGH','MEDIUM','LOW'].includes(i.severity)||!['OPEN','MITIGATING','VERIFIED'].includes(i.status))errors.push(i.id+' invalid status or severity');
  for(const k of ['loggedAt','symptom','rootCause','prevention','regressionTest','evidence'])if(typeof i[k]!=='string'||!i[k].trim())errors.push(i.id+' missing '+k);
  if(i.status==='VERIFIED'&&(i.rootCause==='UNCONFIRMED'||i.regressionTest==='PENDING'||!existsSync(resolve(ROOT,i.regressionTest))||!i.reviewedBy||!i.verificationEvidence))errors.push(i.id+' no confirmed cause/regression/reviewer');
 }
 return errors;
};
export const blockers=(risks,incidents)=>[
 ...risks.risks.filter(x=>x.priority==='P0'&&x.status!=='VERIFIED').map(x=>x.id),
 ...incidents.incidents.filter(x=>['CRITICAL','HIGH'].includes(x.severity)&&x.status!=='VERIFIED').map(x=>x.id)
];
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const risks=JSON.parse(readFileSync(resolve(ROOT,'harness/known-risks.json')));
 const incidents=JSON.parse(readFileSync(resolve(ROOT,'harness/incidents.json')));
 const errors=validate(risks,incidents);
 try{
  const pkg=JSON.parse(readFileSync(resolve(ROOT,'package.json')));
  if(pkg.scripts?.start!=='node server.js')errors.push('Start contract changed');
  new Script(readFileSync(resolve(ROOT,'server.js'),'utf8'),{filename:'server.js'});
  const html=readFileSync(resolve(ROOT,'public/index.html'),'utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  if(!scripts.length)errors.push('No inline browser JS');
  for(const script of scripts)new Script(script[1],{filename:'public/index.html'});
 }catch(e){errors.push('Syntax/config: '+e.message)}
 try{
  const paths=execFileSync('git',['ls-files'],{cwd:ROOT,encoding:'utf8'}).split('\n');
  const secret=paths.filter(p=>!/(^|\/)\.env\.(example|sample)$/.test(p)&&/(^|\/)(\.env(?:\.[^/]*)?|credentials\.json|id_rsa)$|\.(pem|p12|pfx)$/.test(p));
  if(secret.length)errors.push('Tracked sensitive filename(s): '+secret.join(', '));
 }catch(e){errors.push('Git secret filename check NOT_RUN: '+e.message)}
 const open=blockers(risks,incidents);
 if(process.argv.includes('--release'))errors.push(...open.map(x=>'RELEASE BLOCKED: '+x));
 else console.log('Release blockers remaining: '+open.length+' (preflight does not approve release)');
 for(const e of errors)console.error('FAIL '+e);
 console.log('SAI HARNESS '+(errors.length?'FAIL':'PASS')+' (structural only; browser/production NOT_RUN)');
 if(errors.length)process.exitCode=1;
}

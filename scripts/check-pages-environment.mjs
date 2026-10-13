import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const UI_BRANCH='ui/promise-box-v1-preview-20261013';
// Checks saved observations from the actual Pages-only environment settings.
// This offline guard does not contact GitHub or prove that saved evidence is current.
export function checkPagesEnvironment(snapshot) {
 if(typeof snapshot!=='string'||!snapshot.includes('heading "Environments / Configure github-pages"'))throw new Error('Pages-only environment observation required');
 const start=snapshot.indexOf('heading "Deployment branches and tags"');
 const end=snapshot.indexOf('heading "Environment secrets"',start);
 if(start<0||end<0)throw new Error('Deployment branch observation missing');
 const rules=snapshot.slice(start,end);
 if(!rules.includes('button "Selected branches and tags"')||!rules.includes('1 branch and 0 tags allowed'))throw new Error('Exactly one selected branch and zero tags required');
 const level=rules.match(/^([ \t]*)- generic: 1 branch and 0 tags allowed$/m)?.[1];
 const branches=[...rules.matchAll(/^([ \t]*)- generic: (.+)$/gm)].filter(match=>match[1]===level).map(match=>match[2].trim()).filter(value=>value!=='1 branch and 0 tags allowed'&&!value.startsWith('Currently applies'));
 if(branches.length!==1||branches[0]!==UI_BRANCH)throw new Error('Only the exact UI branch may publish Pages');
 if(!snapshot.includes('This environment has no secrets.')||!snapshot.includes('This environment has no variables.'))throw new Error('Pages must have no environment credentials or variables');
 return {status:'PASS',environment:'github-pages',policy:'Selected branches and tags',allowedBranches:branches,allowedTags:0,evidenceType:'saved actual browser observation; deployment must be verified separately'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {if(!process.argv[2])throw new Error('Usage: node scripts/check-pages-environment.mjs <current-settings-snapshot.txt>');console.log(JSON.stringify(checkPagesEnvironment(readFileSync(process.argv[2],'utf8'))));}
 catch(error){console.error('FAIL '+error.message);process.exitCode=1;}
}

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
export const APPROVED_UI='558689d426f87ae7e9c92bf28a5e810b64b6a1b5';
export const UI_BRANCH='ui/promise-box-emotional-v2-20261015';
// This is a one-candidate publisher, not a general YAML/security parser.
// Any workflow byte change needs a new explicit review before this pin changes.
export const REVIEWED_WORKFLOW_SHA256='ff5af71a6e1f00b993563884c264df1b6ea878299c7afb06889c1b18756f47ae';
export function checkWorkflow(source){
 source=source.replaceAll('\r\n','\n');
 const fail=reason=>{throw Error(reason);};
 const requireText=(text,reason)=>{if(!source.includes(text))fail(reason);};
 requireText('branches: ['+UI_BRANCH+']','Exact V2 branch required');
 requireText('paths: [.github/workflows/ui-v2-pages.yml]','Only reviewed publisher changes may trigger');
 if(/\b(?:pull_request|pull_request_target|workflow_dispatch|repository_dispatch|workflow_run)\s*:/.test(source))fail('Unapproved trigger');
 const jobSource=source.slice(source.indexOf('jobs:'));
 const names=[...jobSource.matchAll(/^  ([a-z]+):\s*$/gm)].map(m=>m[1]);
 // Includes only the three jobs; nested environment/permissions are indented further.
 if(names.join(',')!=='guard,build,publish')fail('Unexpected job inventory');
 const start=source.indexOf('jobs:'),buildStart=source.indexOf('  build:'),publishStart=source.indexOf('  publish:');
 const global=source.slice(0,start),build=source.slice(buildStart,publishStart),publish=source.slice(publishStart);
 if(!global.includes('permissions:\n  contents: read')||/pages:|id-token:/.test(global))fail('Global write permission forbidden');
 if(source.includes('secrets.')||/wrangler\s+(?:deploy|publish)|railway\s+(?:up|deploy)|git\s+(?:push|merge)/.test(source))fail('Non-Pages credentials or deployment');
 if(build.match(/uses: actions\/checkout@v4/g)?.length!==1||!build.includes('ref: '+APPROVED_UI))fail('Build checkout must pin approved UI');
 const proof='test "$(git rev-parse HEAD)" = "'+APPROVED_UI+'"';
 const command='node scripts/build-ui-v2.mjs "$RUNNER_TEMP/approved-ui" "'+APPROVED_UI+'"';
 if(!build.includes(proof)||!build.includes(command)||build.indexOf(proof)>build.indexOf(command))fail('Actual Git identity and explicit artifact stamp required');
 if(!build.includes('uses: actions/upload-pages-artifact@v3')||!build.includes('path: ${{ runner.temp }}/approved-ui')||/pages:\s*write|id-token:\s*write/.test(build))fail('Isolated static artifact required');
 if(!publish.includes("if: github.event_name == 'push' && github.ref == 'refs/heads/"+UI_BRANCH+"'")||!publish.includes('needs: build')||!publish.includes('name: github-pages')||!publish.includes('pages: write')||!publish.includes('id-token: write')||!publish.includes('uses: actions/deploy-pages@v4')||/\brun:|uses: actions\/checkout/.test(publish))fail('Pages-only protected publisher required');
 if(createHash('sha256').update(source).digest('hex')!==REVIEWED_WORKFLOW_SHA256)fail('Unreviewed controller workflow fingerprint; publication blocked');
 return {status:'PASS',approvedSource:APPROVED_UI,branch:UI_BRANCH,artifactFiles:14,workflowSha256:REVIEWED_WORKFLOW_SHA256,scope:'Exact reviewed workflow bytes only, not a general YAML validator; live deployed asset verification still required'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const text=readFileSync(new URL('../.github/workflows/ui-v2-pages.yml',import.meta.url),'utf8').replaceAll('\r\n','\n');console.log(JSON.stringify(checkWorkflow(text)));}catch(error){console.error(error.message);process.exitCode=1;}}

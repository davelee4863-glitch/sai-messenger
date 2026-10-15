import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {checkWorkflow,APPROVED_UI,UI_BRANCH} from '../scripts/check-ui-v2-pages.mjs';
import {FILES,IMAGE_HASHES} from '../scripts/build-ui-v2.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),text=readFileSync(new URL('../.github/workflows/ui-v2-pages.yml',import.meta.url),'utf8').replaceAll('\r\n','\n');
const PREVIOUS_UI='558689d426f87ae7e9c92bf28a5e810b64b6a1b5';
const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:8*1024*1024});
test('Pages: exact approved source has a distinct Pages-only controller',()=>assert.equal(checkWorkflow(text).approvedSource,APPROVED_UI));
test('Pages: guard checkout includes approved historical Git blobs',()=>{const guard=text.slice(text.indexOf('  guard:'),text.indexOf('  build:'));assert.match(guard,/fetch-depth: 0/);});
test('Pages: changed source commit and PR merge source are rejected',()=>{for(const sha of ['2c3653d2a490ed7666723ba42c96e3c0236f64d6','a4b69d516c17529cba595b1c1b3067426d470ef3'])assert.throws(()=>checkWorkflow(text.replace('ref: '+APPROVED_UI,'ref: '+sha)),/pin approved/);});
test('Pages: another branch, wildcard and broad event triggers are rejected',()=>{assert.throws(()=>checkWorkflow(text.replace('branches: ['+UI_BRANCH+']','branches: [main]')),/Exact/);assert.throws(()=>checkWorkflow(text.replace('branches: ['+UI_BRANCH+']','branches: [ui/*]')),/Exact/);assert.throws(()=>checkWorkflow(text.replace('on:\n','on:\n  pull_request:\n')),/trigger/);assert.throws(()=>checkWorkflow(text.replace('paths: [.github/workflows/ui-v2-pages.yml]','paths: [preview-v2/**]')),/trigger/);});
test('Pages: controller SHA cannot replace artifact stamp or actual checkout proof',()=>{assert.throws(()=>checkWorkflow(text.replace('"$RUNNER_TEMP/approved-ui" "'+APPROVED_UI+'"','"$RUNNER_TEMP/approved-ui" "$GITHUB_SHA"')),/stamp/);assert.throws(()=>checkWorkflow(text.replace('test "$(git rev-parse HEAD)"','echo "$(git rev-parse HEAD)"')),/identity/);});
test('Pages: checkout root, write-capable builder and alternate environment are rejected',()=>{assert.throws(()=>checkWorkflow(text.replace('path: ${{ runner.temp }}/approved-ui','path: .')),/artifact/);assert.throws(()=>checkWorkflow(text.replace('  build:\n','  build:\n    permissions:\n      pages: write\n')),/artifact/);assert.throws(()=>checkWorkflow(text.replace('name: github-pages','name: production')),/publisher/);});
test('Pages: global write permissions, credentials and non-Pages deploy commands are rejected',()=>{assert.throws(()=>checkWorkflow(text.replace('permissions:\n  contents: read','permissions:\n  contents: read\n  pages: write')),/Global/);assert.throws(()=>checkWorkflow(text+'\n# secrets.CF_ACCESS\n'),/credentials/);assert.throws(()=>checkWorkflow(text+'\n# wrangler deploy\n'),/deployment/);});
test('Pages: removing the successful guard dependency cannot pass publication',()=>assert.throws(()=>checkWorkflow(text.replace('needs: guard','needs: []')),/fingerprint/));
test('Pages: guard failures cannot be ignored',()=>assert.throws(()=>checkWorkflow(text.replace('  guard:\n','  guard:\n    continue-on-error: true\n')),/fingerprint/));
test('Pages: guard job cannot gain repository write permission',()=>assert.throws(()=>checkWorkflow(text.replace('  guard:\n','  guard:\n    permissions:\n      contents: write\n')),/fingerprint/));
test('Pages: suppressing a Git identity failure cannot pass publication',()=>assert.throws(()=>checkWorkflow(text.replace('= "'+APPROVED_UI+'"','= "'+APPROVED_UI+'" || true')),/fingerprint/));
test('Pages: postinspection artifact additions and commented fake pins cannot pass publication',()=>{
 assert.throws(()=>checkWorkflow(text.replace('      - uses: actions/upload-pages-artifact@v3','      - run: cp server.js "$RUNNER_TEMP/approved-ui/server.js"\n      - uses: actions/upload-pages-artifact@v3')),/fingerprint/);
 assert.throws(()=>checkWorkflow(text.replace('          ref: '+APPROVED_UI,'          ref: main\n          # ref: '+APPROVED_UI)),/fingerprint/);
});
test('Pages: V1 and controller product bytes remain at the previous V2 source',()=>{for(const path of ['.github/workflows/ui-preview.yml','scripts/build-ui-preview.mjs','preview-v2/app.mjs','preview-v2/demo-state.mjs','preview-v2/styles.css','preview-v2/assets/family-logo.png','preview-v2/assets/family-story.png']){const disk=readFileSync(new URL('../'+path,import.meta.url)),original=git(['show',PREVIOUS_UI+':'+path]);if(path.endsWith('.png'))assert.deepEqual(disk,original);else assert.equal(disk.toString().replaceAll('\r\n','\n'),original.toString().replaceAll('\r\n','\n'));}});

test('PM023: exact new approval excludes the old UI and temporary PR merge',()=>{assert.equal(APPROVED_UI,'6c1e0429c7265f82c8756454a8c04b3eb9f7425b');for(const other of [PREVIOUS_UI,'7e89250532d5991adeae20ffc2b97e8f6f92164a'])assert.throws(()=>checkWorkflow(text.replace('ref: '+APPROVED_UI,'ref: '+other)),/pin approved/);});
test('PM023: approved fourteen-file tree changes only the two reviewed focus behaviors',()=>{
 const paths=git(['ls-tree','-r','--name-only',APPROVED_UI,'--','preview-v2/']).toString().trim().split(/\r?\n/).map(p=>p.slice('preview-v2/'.length));assert.deepEqual(paths.sort(),[...FILES].sort());
 for(const path of FILES){const current=git(['show',APPROVED_UI+':preview-v2/'+path]),old=git(['show',PREVIOUS_UI+':preview-v2/'+path]);if(path!=='app.mjs'){assert.deepEqual(current,old);continue;}const app=current.toString().replaceAll('\r\n','\n'),pattern=/ \/\/ PM022 modal keyboard boundary\n[\s\S]*? \/\/ PM022 end modal keyboard boundary\n/g,patches=[...app.matchAll(pattern)];assert.equal(patches.length,1);assert.equal(createHash('sha256').update(patches[0][0]).digest('hex'),'320fd0f61dc079a49ef7b8196b735ef23218c67d9d2794f1b918887011f41755');assert.equal(app.replace(pattern,'').replace("(replacement&&!replacement.disabled?replacement:$('#page-heading'))","(replacement||$('#page-heading'))"),old.toString().replaceAll('\r\n','\n'));}
});
test('PM023: both original family image SHA256 values survive hotfix and rollback',()=>{for(const sha of [APPROVED_UI,PREVIOUS_UI])for(const [path,hash]of Object.entries(IMAGE_HASHES))assert.equal(createHash('sha256').update(git(['show',sha+':preview-v2/'+path])).digest('hex'),hash);});

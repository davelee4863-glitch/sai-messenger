import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPagesEnvironment,UI_BRANCH} from '../scripts/check-pages-environment.mjs';
const observed=[
 '- heading "Environments / Configure github-pages" [level=2]',
 '- heading "Deployment branches and tags" [level=3]',
 '- button "Selected branches and tags"',
 '- generic: 1 branch and 0 tags allowed',
 '- generic: '+UI_BRANCH,
 '- generic: Currently applies to 1 branch',
 '- heading "Environment secrets" [level=2]',
 '- generic: This environment has no secrets.',
 '- heading "Environment variables" [level=2]',
 '- generic: This environment has no variables.'
].join('\n');
test('accepts an isolated Pages-only exact UI branch observation',()=>assert.equal(checkPagesEnvironment(observed).status,'PASS'));
test('distinguishes nested button labels from actual branch rules in browser snapshots',()=>assert.equal(checkPagesEnvironment(observed.replace('- button "Selected branches and tags"','- button "Selected branches and tags":\n  - generic: Selected branches and tags').replace('- heading "Environment secrets"','- button "Edit":\n  - generic: Edit\n- button "Remove":\n  - generic: Remove\n- heading "Environment secrets"')).status,'PASS'));
test('rejects the actual first-failure main-only configuration',()=>assert.throws(()=>checkPagesEnvironment(observed.replace(UI_BRANCH,'main')),/exact UI branch/));
test('rejects all-branches mode',()=>assert.throws(()=>checkPagesEnvironment(observed.replace('Selected branches and tags','No restriction')),/selected branch/));
test('rejects a production environment observation',()=>assert.throws(()=>checkPagesEnvironment(observed.replace('Configure github-pages','Configure production')),/Pages-only/));
test('rejects additional branch rules despite a misleading branch count',()=>assert.throws(()=>checkPagesEnvironment(observed.replace('- generic: '+UI_BRANCH,'- generic: '+UI_BRANCH+'\n- generic: main')),/exact UI branch/));
test('rejects allowed deployment tags',()=>assert.throws(()=>checkPagesEnvironment(observed.replace('0 tags allowed','1 tag allowed')),/zero tags/));
test('rejects secrets or variables and incomplete observations',()=>{
 assert.throws(()=>checkPagesEnvironment(observed.replace('This environment has no secrets.','A secret exists.')),/credentials/);
 assert.throws(()=>checkPagesEnvironment(observed.replace('This environment has no variables.','A variable exists.')),/credentials/);
 assert.throws(()=>checkPagesEnvironment(''),/observation/);
 assert.throws(()=>checkPagesEnvironment(observed.replace('Deployment branches and tags','Incomplete rules')),/observation missing/);
});

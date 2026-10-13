import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_BASE = resolve(ROOT, '../pm004/build-test-fixtures');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

function inventory(directory, prefix = '') {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const key = prefix + entry.name;
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? inventory(path, key + '/') : [key];
  }).sort();
}

function fixture(t) {
  mkdirSync(FIXTURE_BASE, {recursive: true});
  const directory = mkdtempSync(resolve(FIXTURE_BASE, 'case-'));
  const repository = resolve(directory, 'repository');
  const output = resolve(directory, 'artifact');
  mkdirSync(resolve(repository, 'scripts'), {recursive: true});
  mkdirSync(resolve(repository, 'harness'), {recursive: true});
  cpSync(resolve(ROOT, 'scripts/build-ui-preview.mjs'), resolve(repository, 'scripts/build-ui-preview.mjs'));
  cpSync(resolve(ROOT, 'harness/check.mjs'), resolve(repository, 'harness/check.mjs'));
  cpSync(resolve(ROOT, 'docs'), resolve(repository, 'docs'), {recursive: true});
  writeFileSync(resolve(repository, 'server.js'), '// SYNTHETIC_PRODUCT_SOURCE_DO_NOT_PUBLISH\n');
  writeFileSync(resolve(repository, 'private-user-data.json'), '{"syntheticPublicationTrap":true}\n');
  t.after(() => {
    const target = resolve(directory);
    assert.ok(target.startsWith(FIXTURE_BASE + sep), 'Fixture cleanup stays inside the created workspace fixture area');
    assert.equal(lstatSync(target).isSymbolicLink(), false);
    rmSync(target, {recursive: true, force: true});
  });
  return {directory, repository, source: resolve(repository, 'docs'), output};
}

function build(value, {sha = COMMIT, output = value.output} = {}) {
  return execFileSync(process.execPath, [resolve(value.repository, 'scripts/build-ui-preview.mjs'), output], {
    cwd: value.repository,
    env: {...process.env, GITHUB_SHA: sha},
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function rejected(action, message) {
  assert.throws(action, error => Number.isInteger(error.status) && error.status !== 0, message);
}

test('Build artifact contains exactly docs assets and preserves every non-metadata byte', t => {
  const value = fixture(t);
  const before = new Map(inventory(value.source).map(path => [path, readFileSync(resolve(value.source, path))]));
  build(value);
  assert.deepEqual(inventory(value.output), [...before.keys()]);
  assert.equal(existsSync(resolve(value.output, 'server.js')), false);
  assert.equal(existsSync(resolve(value.output, 'private-user-data.json')), false);
  for (const [path, contents] of before) {
    assert.deepEqual(readFileSync(resolve(value.source, path)), contents, `Build modified source docs/${path}`);
    if (!['release.mjs', 'version.json'].includes(path)) assert.deepEqual(readFileSync(resolve(value.output, path)), contents, `Build modified UI asset ${path}`);
  }
  assert.equal(readFileSync(resolve(value.repository, 'server.js'), 'utf8'), '// SYNTHETIC_PRODUCT_SOURCE_DO_NOT_PUBLISH\n');
});

test('Both published metadata files identify the exact CI source commit', async t => {
  const value = fixture(t);
  const original = JSON.parse(readFileSync(resolve(value.source, 'version.json'), 'utf8'));
  const started = Date.now();
  const summary = JSON.parse(build(value));
  const metadata = JSON.parse(readFileSync(resolve(value.output, 'version.json'), 'utf8'));
  const {RELEASE} = await import(pathToFileURL(resolve(value.output, 'release.mjs')).href);
  assert.equal(metadata.sourceCommit, COMMIT);
  assert.equal(summary.sourceCommit, COMMIT);
  assert.equal(summary.directory, value.output);
  assert.deepEqual(RELEASE, metadata);
  assert.equal(metadata.version, original.version);
  assert.deepEqual(metadata.changes, original.changes);
  assert.ok(Date.parse(metadata.updatedAt) >= started && Date.parse(metadata.updatedAt) <= Date.now());
});

test('Malformed CI commit IDs fail before writing an artifact', t => {
  for (const sha of ['short', 'a'.repeat(39), 'a'.repeat(41), 'z'.repeat(40), '../main', COMMIT + '\n']) {
    const value = fixture(t);
    rejected(() => build(value, {sha}), `Accepted malformed SHA: ${JSON.stringify(sha)}`);
    assert.equal(existsSync(value.output), false, 'Invalid SHA created output');
  }
});

test('Build refuses source, ancestor, descendant and checkout output paths', t => {
  const value = fixture(t);
  const original = readFileSync(resolve(value.source, 'version.json'));
  const unsafeOutputs = [value.source, value.repository, value.directory, resolve(value.source, 'nested'), resolve(value.repository, 'public'), resolve(value.source, '..', 'public')];
  if (process.platform === 'win32') unsafeOutputs.push(value.source.toUpperCase());
  for (const output of unsafeOutputs) rejected(() => build(value, {output}), `Unsafe output accepted: ${output}`);
  assert.deepEqual(readFileSync(resolve(value.source, 'version.json')), original);
  assert.equal(existsSync(resolve(value.repository, 'public')), false);
});

test('Pre-existing output files cannot leak product sources into the Pages artifact', t => {
  const value = fixture(t);
  mkdirSync(value.output);
  writeFileSync(resolve(value.output, 'server.js'), '// SYNTHETIC_STALE_SERVER\n');
  rejected(() => build(value), 'Nonempty artifact output was overlaid instead of rejected');
  assert.deepEqual(inventory(value.output), ['server.js']);
  assert.equal(readFileSync(resolve(value.output, 'server.js'), 'utf8'), '// SYNTHETIC_STALE_SERVER\n');
});

test('Publication rejects unapproved file types and known credential filenames', t => {
  for (const path of ['server.js', 'customer-backup.sql', '.env.json', 'credentials.json', 'service-account.json']) {
    const value = fixture(t);
    writeFileSync(resolve(value.source, path), 'SYNTHETIC_FILE_MUST_NOT_PUBLISH\n');
    rejected(() => build(value), `Published unapproved file: ${path}`);
    assert.equal(existsSync(value.output), false);
  }
});

test('A symlink within docs cannot escape into another repository directory', t => {
  const value = fixture(t);
  const outside = resolve(value.directory, 'synthetic-outside');
  mkdirSync(outside);
  writeFileSync(resolve(outside, 'outside.json'), '{"syntheticOutside":true}\n');
  symlinkSync(outside, resolve(value.source, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  rejected(() => build(value), 'Source symlink escape was accepted');
  assert.equal(existsSync(value.output), false);
  assert.equal(readFileSync(resolve(outside, 'outside.json'), 'utf8'), '{"syntheticOutside":true}\n');
});

test('Output symlinks are rejected without writing into their target', t => {
  const value = fixture(t);
  const target = resolve(value.directory, 'synthetic-output-target');
  mkdirSync(target);
  symlinkSync(target, value.output, process.platform === 'win32' ? 'junction' : 'dir');
  rejected(() => build(value), 'Output symlink was accepted');
  assert.deepEqual(inventory(target), []);
});

test('Output ancestor symlinks cannot redirect a build to another directory', t => {
  const value = fixture(t);
  const target = resolve(value.directory, 'synthetic-parent-target');
  const link = resolve(value.directory, 'synthetic-parent-link');
  mkdirSync(target);
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  rejected(() => build(value, {output: resolve(link, 'artifact')}), 'Output ancestor symlink was accepted');
  assert.deepEqual(inventory(target), []);
});

test('Source docs itself cannot be replaced by a symlink', t => {
  const value = fixture(t);
  const target = resolve(value.directory, 'synthetic-source-target');
  cpSync(value.source, target, {recursive: true});
  const sourceTarget = resolve(value.source);
  assert.ok(sourceTarget.startsWith(resolve(value.repository) + sep));
  assert.equal(lstatSync(sourceTarget).isSymbolicLink(), false);
  rmSync(sourceTarget, {recursive: true});
  symlinkSync(target, sourceTarget, process.platform === 'win32' ? 'junction' : 'dir');
  rejected(() => build(value), 'Source directory symlink was accepted');
  assert.equal(existsSync(value.output), false);
});

function workflowJob(source, name) {
  const match = source.match(new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `Workflow job ${name} exists`);
  return match[1];
}

test('Pages publication is restricted to the separate UI branch and requires successful verification', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/ui-preview.yml'), 'utf8');
  const publish = workflowJob(workflow, 'publish');
  const verify = workflowJob(workflow, 'verify');
  assert.match(workflow, /^    branches: \[ui\/promise-box-v1-preview-20261013\]\s*$/m);
  assert.doesNotMatch(workflow, /pull_request_target|railway|production|workflow_run/i);
  assert.match(publish, /^    if: github\.ref == 'refs\/heads\/ui\/promise-box-v1-preview-20261013'\s*$/m);
  assert.match(publish, /^    needs: verify\s*$/m);
  assert.doesNotMatch(verify + publish, /continue-on-error|always\(\)|\|\|\s*true/);
  assert.match(verify, /- run: node harness\/check\.mjs\s*(?:\r?\n|$)/);
  const testCommand = verify.match(/- run: (node --test[^\r\n]*)/)?.[1];
  assert.ok(testCommand, 'Automatic verification test command');
  for (const path of ['harness/check.test.mjs', 'tests/ui-state.test.mjs', 'tests/ui-static.test.mjs', 'tests/ui-qr.test.mjs', 'tests/ui-build.test.mjs']) assert.ok(testCommand.split(/\s+/).includes(path), `Missing verification gate: ${path}`);
});

test('Pages workflow uploads only the isolated build output and grants publish permissions only to its publish job', () => {
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/ui-preview.yml'), 'utf8');
  const publish = workflowJob(workflow, 'publish');
  const verify = workflowJob(workflow, 'verify');
  assert.match(workflow, /^permissions:\r?\n  contents: read\r?\n/m);
  assert.doesNotMatch(verify, /pages: write|id-token: write|contents: write/);
  assert.match(publish, /^      pages: write\s*$/m);
  assert.match(publish, /^      id-token: write\s*$/m);
  assert.doesNotMatch(publish, /contents: write/);
  const commands = [...publish.matchAll(/- run: ([^\r\n]*)/g)].map(([, command]) => command.trim());
  assert.deepEqual(commands, ['node scripts/build-ui-preview.mjs "$RUNNER_TEMP/promise-box-site"']);
  assert.match(publish, /uses: actions\/upload-pages-artifact@v3\r?\n        with:\r?\n          path: \$\{\{ runner\.temp \}\}\/promise-box-site\s*(?:\r?\n|$)/);
  assert.match(publish, /uses: actions\/deploy-pages@v4/);
});

test('Published QR implementation preserves attribution and the complete MIT license notice', () => {
  const vendor = readFileSync(resolve(ROOT, 'docs/vendor/qrcode.mjs'), 'utf8').replace(/^\/\/\s?/gm, '').replace(/\s+/g, ' ');
  for (const required of [
    'Copyright (c) 2009 Kazuhiko Arase',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'The above copyright notice and this permission notice shall be included',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND',
    'IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE',
  ]) assert.ok(vendor.includes(required), `Missing published QR license notice: ${required}`);
});

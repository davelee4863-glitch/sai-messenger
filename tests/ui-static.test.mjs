import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, extname, resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {containsSecret, sensitivePath} from '../harness/check.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = resolve(ROOT, 'docs');
const requiredAssets = ['index.html', 'app.mjs', 'styles.css', 'demo-state.mjs', 'qr.mjs', 'release.mjs', 'manifest.webmanifest', 'icon.svg', 'version.json', '.nojekyll'];
const read = name => readFileSync(resolve(DOCS, name), 'utf8');
const rules = JSON.parse(readFileSync(resolve(ROOT, 'harness/ui-preview-rules.json'), 'utf8'));

function filesWithin(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const full = resolve(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `Published symlink: ${relative(DOCS, full)}`);
    return entry.isDirectory() ? filesWithin(full) : [full];
  });
}

function localAsset(reference, containingFile) {
  assert.ok(reference && !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(reference), `Non-relative asset: ${reference}`);
  const path = reference.split(/[?#]/)[0];
  assert.ok(!path.includes('\\'), `Backslash asset: ${reference}`);
  const target = resolve(dirname(containingFile), decodeURIComponent(path));
  assert.ok(target.startsWith(DOCS + sep), `Asset escapes docs/: ${reference}`);
  assert.ok(existsSync(target) && statSync(target).isFile(), `Missing local asset: ${reference}`);
  return target;
}

function directives(html) {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
  const meta = metas.find(tag => /http-equiv\s*=\s*["']content-security-policy["']/i.test(tag));
  assert.ok(meta, 'CSP meta is required');
  const firstExecutable = html.search(/<(?:script|link)\b/i);
  assert.ok(firstExecutable < 0 || html.indexOf(meta) < firstExecutable, 'CSP must precede executable and stylesheet assets');
  const content = meta.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? meta.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
  assert.ok(content, 'CSP content is required');
  return new Map(content.split(';').map(value => value.trim().split(/\s+/)).filter(([key]) => key).map(([key, ...values]) => [key.toLowerCase(), values]));
}

test('UI preview publishes all required assets and no sensitive/server files', () => {
  for (const asset of requiredAssets) assert.ok(existsSync(resolve(DOCS, asset)) && statSync(resolve(DOCS, asset)).isFile(), `Missing docs/${asset}`);
  for (const file of filesWithin(DOCS)) {
    const path = relative(DOCS, file).replaceAll('\\', '/');
    assert.equal(sensitivePath(path), false, `Sensitive published path: ${path}`);
    assert.ok(path === '.nojekyll' || ['.html', '.css', '.mjs', '.json', '.svg', '.webmanifest'].includes(extname(path)), `Unreviewed publication type: ${path}`);
    assert.ok(!/(?:^|\/)(?:server\.[cm]?js|package(?:-lock)?\.json|incidents\.json|known-risks\.json)$/.test(path), `Non-UI source in publication: ${path}`);
  }
});

test('CSP blocks outbound connections, forms, base changes and executable injection', () => {
  const policy = directives(read('index.html'));
  for (const key of ['default-src', 'connect-src', 'base-uri', 'form-action', 'object-src']) assert.deepEqual(policy.get(key), ["'none'"], `${key} must be none`);
  for (const key of ['script-src', 'style-src', 'font-src']) assert.deepEqual(policy.get(key), ["'self'"], `${key} must allow local sources only`);
  for (const [key, values] of policy) assert.ok(!values.some(value => /unsafe-inline|unsafe-eval|https?:|\*/i.test(value)), `Unsafe CSP source in ${key}`);
});

test('HTML executes local modules only and has no inline executable handlers', () => {
  const html = read('index.html');
  assert.match(html, /<html\b[^>]*\blang\s*=\s*["']ko["']/i, 'Korean document language');
  assert.match(html, /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i, 'Mobile viewport');
  assert.doesNotMatch(html, /\bon[a-z]+\s*=/i, 'Inline event handlers are forbidden');
  assert.doesNotMatch(html, /(?:href|src)\s*=\s*["']\s*(?:javascript|vbscript):/i, 'Executable URL');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, 'UI module script exists');
  for (const [, attributes, body] of scripts) {
    assert.match(attributes, /\btype\s*=\s*["']module["']/i, 'Script must be an ES module');
    const src = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    assert.ok(src, 'Inline executable script is forbidden');
    assert.equal(body.trim(), '', 'External script must have no inline body');
    localAsset(src, resolve(DOCS, 'index.html'));
  }
});

test('HTML, CSS and module asset references work in a Pages repository subdirectory', () => {
  for (const file of filesWithin(DOCS)) {
    const source = readFileSync(file, 'utf8');
    if (extname(file) === '.html') {
      for (const [, attribute, reference] of source.matchAll(/\b(src|href)\s*=\s*["']([^"']+)["']/gi)) {
        if (attribute.toLowerCase() === 'href' && reference.startsWith('#')) continue;
        localAsset(reference, file);
      }
    }
    if (extname(file) === '.mjs') {
      assert.doesNotMatch(source, /\bimport\s*\(/, 'Dynamic imports are not part of this reviewed artifact');
      for (const [, reference] of source.matchAll(/(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g)) localAsset(reference, file);
    }
    if (extname(file) === '.css') {
      assert.doesNotMatch(source, /@import\b/i, 'Stylesheets stay local and explicit');
      for (const [, reference] of source.matchAll(/url\(\s*["']?([^\s)"']+)/gi)) localAsset(reference, file);
    }
  }
});

test('Published executable sources have no network, persistence or unsafe HTML APIs', () => {
  const prohibited = [
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|RTCDataChannel|importScripts)\b/,
    /\b(?:sendBeacon|localStorage|sessionStorage|indexedDB|serviceWorker|caches)\b/,
    /\b(?:innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment)\b/,
    /\bdocument\s*(?:\.\s*(?:write|writeln|cookie)|\[\s*["'](?:write|writeln|cookie)["']\s*\])/,
    /\b(?:eval|Function)\s*\(/,
    /\b(?:setTimeout|setInterval)\s*\(\s*["'`]/,
    /\b(?:window|document|globalThis)\s*\[\s*["'](?:fetch|WebSocket|localStorage|sessionStorage|indexedDB)["']\s*\]/,
    /(?:sai-messenger-production|railway\.app)/i
  ];
  for (const file of filesWithin(DOCS).filter(file => ['.mjs', '.html'].includes(extname(file)))) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of prohibited) assert.doesNotMatch(source, pattern, `Prohibited browser capability in ${relative(DOCS, file)}`);
  }
});

test('Every published module parses without executing browser or top-level code', () => {
  const options = {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']};
  // These stdin probes verify that the check really rejects invalid syntax and
  // never evaluates a valid module. No browser or product server is started.
  assert.throws(() => execFileSync(process.execPath, ['--check', '--input-type=module'], {...options, input: 'export const broken = (;'}), error => error.status !== 0 && /SyntaxError/.test(error.stderr));
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', '--input-type=module'], {...options, input: "throw new Error('PARSE_CHECK_MUST_NOT_EXECUTE');"}));
  const modules = filesWithin(DOCS).filter(file => extname(file) === '.mjs');
  assert.ok(modules.length > 0, 'Published modules exist');
  for (const file of modules) assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', file], options), `JavaScript syntax failure in ${relative(DOCS, file)}`);
});

test('Published sources do not contain recognizable credentials or production endpoint strings', () => {
  for (const file of filesWithin(DOCS)) {
    const source = readFileSync(file, 'utf8');
    assert.equal(containsSecret(source), false, `Potential credential in ${relative(DOCS, file)}`);
    assert.doesNotMatch(source, /sai-messenger-production|railway\.app/i, `Production endpoint in ${relative(DOCS, file)}`);
  }
});

test('SVG assets contain passive local graphics only', () => {
  for (const file of filesWithin(DOCS).filter(file => extname(file) === '.svg')) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /<(?:script|foreignObject|iframe|object|embed)\b|\bon[a-z]+\s*=/i, `Executable SVG markup in ${relative(DOCS, file)}`);
    for (const [, reference] of source.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
      if (reference.startsWith('#')) continue;
      localAsset(reference, file);
    }
  }
});

test('Install manifest uses local relative paths without claiming cached offline support', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.ok(typeof manifest.name === 'string' && manifest.name.includes('약속함'), 'Manifest uses the brand name');
  assert.ok(typeof manifest.short_name === 'string' && manifest.short_name.trim(), 'Manifest short name');
  assert.equal(manifest.lang, 'ko', 'Korean installation language');
  assert.equal(manifest.start_url, './', 'Start URL stays within the Pages project');
  assert.equal(manifest.scope, './', 'Manifest scope stays within the Pages project');
  assert.ok(['standalone', 'minimal-ui', 'browser'].includes(manifest.display), 'Valid installation display');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'Local installation icon');
  for (const icon of manifest.icons) localAsset(icon.src, resolve(DOCS, 'manifest.webmanifest'));
});

test('Published version metadata supplies a source commit, update timestamp and human-readable changes', async () => {
  const metadata = JSON.parse(read('version.json'));
  assert.ok(typeof metadata.version === 'string' && metadata.version.trim(), 'Nonempty version');
  assert.ok(typeof metadata.sourceCommit === 'string' && (metadata.sourceCommit === 'LOCAL_PREVIEW' || /^[a-f\d]{40}$/i.test(metadata.sourceCommit)), 'Source commit is a complete SHA or an explicit unpublished marker');
  assert.ok(typeof metadata.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(metadata.updatedAt) && Number.isFinite(Date.parse(metadata.updatedAt)), 'UTC update timestamp');
  assert.equal(new Date(metadata.updatedAt).toISOString(), metadata.updatedAt.replace(/(?<!\.\d{3})Z$/, '.000Z'), 'Update timestamp is a real calendar instant');
  assert.ok(Array.isArray(metadata.changes) && metadata.changes.length > 0 && metadata.changes.every(change => typeof change === 'string' && change.trim()), 'Readable change history');
  const {RELEASE} = await import('../docs/release.mjs');
  assert.deepEqual(RELEASE, metadata, 'Visible release metadata matches the JSON artifact');
});

function luminance(hex) {
  const normalized = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);
  const channels = normalized.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(first, second) {
  const left = luminance(first), right = luminance(second);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

test('Color contrast calculation matches the WCAG reference endpoints', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.equal(contrast('#ffffff', '#ffffff'), 1);
  assert.ok(Math.abs(contrast('#777777', '#ffffff') - 4.478089453577214) < 0.000001);
});

for (const [kind, pairs] of Object.entries(rules.paletteContract).filter(([, value]) => Array.isArray(value))) {
  for (const [foreground, background] of pairs) {
    test(`${kind} contrast: ${foreground} against ${background}`, () => {
      const css = read('styles.css');
      const colors = new Map([...css.matchAll(/(--[a-z][a-z\d-]*)\s*:\s*(#[a-f\d]{6})\b/gi)].map(([, key, value]) => [key, value]));
      const color = value => value.startsWith('#') ? value : colors.get(value);
      assert.ok(color(foreground) && color(background), 'Required palette token');
      const ratio = contrast(color(foreground), color(background));
      const minimum = kind === 'focus' ? 3 : 4.5;
      assert.ok(ratio >= minimum, `${ratio.toFixed(3)}:1 is below ${minimum}:1`);
    });
  }
}

test('Styles expose keyboard focus and honor reduced-motion preferences', () => {
  const css = read('styles.css');
  assert.match(css, /:focus-visible\b/, 'Visible keyboard focus');
  assert.match(css, /prefers-reduced-motion\s*:\s*reduce/i, 'Reduced-motion override');
  assert.doesNotMatch(css, /(?:outline\s*:\s*(?:none|0)|outline-width\s*:\s*0)(?:\s*[;}])/i, 'Do not suppress focus outlines globally');
});

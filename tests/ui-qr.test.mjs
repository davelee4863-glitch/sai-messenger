import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from './vendor/jsqr.cjs';
import { qrMatrix } from '../docs/qr.mjs';

const livePreviewInvite = 'https://davelee4863-glitch.github.io/sai-messenger/#invite/group-weekend';
const localhostInvite = 'http://localhost:4173/#invite/group-weekend';

// Rasterize the actual generator matrix. Four white modules surround it, using
// the same dark color as the SVG. The independent decoder sees only RGBA pixels.
function rasterize(matrix, scale = 5) {
  const quietZone = 4;
  const side = matrix.length + quietZone * 2;
  const width = side * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix.length; col++) {
      if (!matrix[row][col]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const offset = (((row + quietZone) * scale + y) * width + (col + quietZone) * scale + x) * 4;
          data.set([53, 47, 41, 255], offset);
        }
      }
    }
  }
  return { data, width, height: width };
}

function decode(text, scale = 5) {
  const image = rasterize(qrMatrix(text), scale);
  const decoded = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
  assert.ok(decoded, `Independent jsQR could not decode ${text}`);
  return decoded;
}

test('GitHub Pages HTTPS group invite round-trips through an independent image decoder', () => {
  const decoded = decode(livePreviewInvite);
  assert.equal(decoded.data, livePreviewInvite);
  assert.equal(Buffer.from(decoded.binaryData).toString('utf8'), livePreviewInvite);
  assert.ok(decoded.version >= 1);
});

test('localhost group invite round-trips through an independent image decoder', () => {
  assert.equal(decode(localhostInvite).data, localhostInvite);
});

test('127.0.0.1 direct-chat invite preserves host, port and room route exactly', () => {
  const url = 'http://127.0.0.1:4173/#invite/direct-minseo';
  assert.equal(decode(url).data, url);
});

test('published invite is independently decodable at small and large raster scales', () => {
  for (const scale of [2, 8]) assert.equal(decode(livePreviewInvite, scale).data, livePreviewInvite);
});

test('encoded path and query data are preserved without execution', () => {
  const url = 'https://example.test/%EC%95%BD%EC%86%8D%ED%95%A8/?label=%3Cscript%3E#invite/group-weekend';
  assert.equal(decode(url).data, url);
});

test('500 ASCII characters at the documented limit are still decodable', () => {
  const text = 'https://example.test/#invite/' + 'a'.repeat(500 - 'https://example.test/#invite/'.length);
  assert.equal(text.length, 500);
  assert.equal(decode(text, 3).data, text);
});

test('oversized and non-string QR inputs are rejected', () => {
  for (const value of ['a'.repeat(501), undefined, null, 123, {}, [], true]) {
    assert.throws(() => qrMatrix(value), error => error instanceof Error && /초대 링크/.test(error.message));
  }
});

test('QR output is a boolean square using a valid QR version dimension', () => {
  const matrix = qrMatrix(livePreviewInvite);
  assert.equal((matrix.length - 21) % 4, 0);
  assert.ok(matrix.length >= 21 && matrix.length <= 177);
  assert.ok(matrix.every(row => row.length === matrix.length && row.every(value => typeof value === 'boolean')));
});

test('four-module raster quiet zone is white on every edge', () => {
  const scale = 3;
  const image = rasterize(qrMatrix(livePreviewInvite), scale);
  const edge = 4 * scale;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (x >= edge && x < image.width - edge && y >= edge && y < image.height - edge) continue;
      const offset = (y * image.width + x) * 4;
      assert.deepEqual(Array.from(image.data.slice(offset, offset + 4)), [255, 255, 255, 255]);
    }
  }
});

test('independent decoder rejects a blank image instead of echoing expected data', () => {
  const image = rasterize(qrMatrix(livePreviewInvite));
  image.data.fill(255);
  assert.equal(jsQR(image.data, image.width, image.height), null);
});

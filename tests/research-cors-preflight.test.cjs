'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const workerPromise = import(pathToFileURL(join(__dirname, '..', 'backend', 'cloudflare-r204-review', 'worker.mjs')).href);

async function preflight(origin, requestedHeaders = 'content-type,x-tens-public-session') {
  const worker = (await workerPromise).default;
  const headers = {
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': requestedHeaders,
  };
  if (origin !== null) headers.Origin = origin;
  return worker.fetch(new Request('https://api.asktens.com/api/research', { method: 'OPTIONS', headers }), {});
}

test('approved AskTENS origin explicitly allows the public research session header', async () => {
  const response = await preflight('https://asktens.com');
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://asktens.com');
  const methods = response.headers.get('access-control-allow-methods').split(',').map(s => s.trim());
  assert(methods.includes('POST'));
  const names = response.headers.get('access-control-allow-headers').toLowerCase().split(',').map(s => s.trim());
  assert(names.includes('content-type'));
  assert(names.includes('authorization'));
  assert(names.includes('x-tens-public-session'));
  assert(!response.headers.get('access-control-allow-credentials'));
});

test('foreign origin cannot preflight research even with the same requested headers', async () => {
  const response = await preflight('https://untrusted.example');
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('missing origin cannot preflight research', async () => {
  const response = await preflight(null);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('subdomain and HTTP origin are not silently trusted', async () => {
  for (const origin of ['https://other.asktens.com', 'http://asktens.com']) {
    const response = await preflight(origin);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});

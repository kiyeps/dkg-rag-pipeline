// D1 integration tests against the real HTTP server:
// request contract, content-type gate, Origin/Host loopback boundary, auth.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(root, 'src', 'cli.js');
const PORT = 18861;

function startServer(extraEnv = {}) {
  const child = spawn(process.execPath, [CLI, 'serve'], {
    env: { ...process.env, DKG_RAG_PORT: String(PORT), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = { out: '', err: '' };
  child.stdout.on('data', d => { logs.out += d; });
  child.stderr.on('data', d => { logs.err += d; });
  return { child, logs };
}

async function waitHealth(opts = {}) {
  const timeoutMs = typeof opts === 'number' ? opts : (opts.timeoutMs || 45000);
  const token = typeof opts === 'object' && opts.token ? opts.token : null;
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`,
        token ? { headers: { Authorization: 'Bearer ' + token } } : undefined);
      if (r.status === 200) return true;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('server did not become healthy');
    await new Promise(r => setTimeout(r, 250));
  }
}

function stopServer(child) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 8000);
    t.unref();
    child.once('exit', () => { clearTimeout(t); resolve(); });
    try { child.kill('SIGTERM'); } catch { clearTimeout(t); resolve(); }
  });
}

function rawRequest(path, headers, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function postJson(path, payload, extraHeaders = {}) {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  return { status: r.status, json, text };
}

test('server/d1: request contract on loopback', async () => {
  const { child, logs } = startServer();
  try {
    await waitHealth();
    const health = await fetch(`http://127.0.0.1:${PORT}/health`);
    assert.strictEqual(health.status, 200);

    let r = await postJson('/retrieve', { query: 'alpha beta gamma', k: 2 });
    assert.strictEqual(r.status, 200, 'valid request must succeed');
    assert.ok(Array.isArray(r.json.results));

    r = await postJson('/retrieve', {});
    assert.strictEqual(r.status, 400);
    assert.match(r.json.error, /query/);

    r = await postJson('/retrieve', { query: 123 });
    assert.strictEqual(r.status, 400);

    r = await postJson('/retrieve', { query: '   ' });
    assert.strictEqual(r.status, 400);

    r = await postJson('/retrieve', { query: 'ok', k: 0 });
    assert.strictEqual(r.status, 400);
    r = await postJson('/retrieve', { query: 'ok', k: 51 });
    assert.strictEqual(r.status, 400);
    r = await postJson('/retrieve', { query: 'ok', k: '5' });
    assert.strictEqual(r.status, 400);

    r = await postJson('/retrieve', '{not-json');
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.json.error, 'invalid json body');

    r = await postJson('/retrieve', { query: 'ok' }, { 'Content-Type': 'text/plain' });
    assert.strictEqual(r.status, 415, 'non-JSON content-type must be rejected');

    r = await postJson('/retrieve', { query: 'ok' }, { Origin: 'http://evil.com' });
    assert.strictEqual(r.status, 403, 'cross-origin simple request must be rejected');

    r = await postJson('/retrieve', { query: 'ok' }, { Origin: 'http://127.0.0.1:3000' });
    assert.strictEqual(r.status, 200, 'loopback origin allowed');

    r = await postJson('/retrieve', { query: 'ok' }, { Origin: 'null' });
    assert.strictEqual(r.status, 403, 'sandboxed null origin rejected');

    const nf = await postJson('/nope', {});
    assert.strictEqual(nf.status, 404);
    const opt = await rawRequest('/retrieve', {}, 'OPTIONS');
    assert.strictEqual(opt.status, 204);
  } finally {
    await stopServer(child);
    assert.ok(logs.out.includes('serving on'), 'startup banner expected');
  }
});

test('server/d1: Host header boundary (raw HTTP)', async () => {
  const { child } = startServer();
  try {
    await waitHealth();
    let r = await rawRequest('/health', { Host: `127.0.0.1:${PORT}` });
    assert.strictEqual(r.status, 200);
    r = await rawRequest('/health', { Host: `localhost:${PORT}` });
    assert.strictEqual(r.status, 200);
    r = await rawRequest('/health', { Host: 'evil.com' });
    assert.strictEqual(r.status, 403, 'foreign Host must be rejected');
    r = await rawRequest('/health', { Host: `127.0.0.1:${PORT}`, Origin: 'http://localhost.evil.com' });
    assert.strictEqual(r.status, 403, 'lookalike origin must be rejected');
  } finally {
    await stopServer(child);
  }
});

test('server/d1: exposed mode requires the bearer token on every route', async () => {
  const { child } = startServer({ DKG_RAG_HOST: '0.0.0.0', DKG_RAG_TOKEN: 'test-token-12345' });
  try {
    await waitHealth({ token: 'test-token-12345' });
    let r = await rawRequest('/health', { Host: `127.0.0.1:${PORT}` });
    assert.strictEqual(r.status, 401, 'no token -> 401');
    r = await rawRequest('/health', { Host: `127.0.0.1:${PORT}`, Authorization: 'Bearer wrong-token' });
    assert.strictEqual(r.status, 401, 'wrong token -> 401');
    r = await rawRequest('/health', { Host: `127.0.0.1:${PORT}`, Authorization: 'Bearer test-token-12345' });
    assert.strictEqual(r.status, 200, 'correct token -> 200');
    r = await rawRequest('/retrieve', { Host: `127.0.0.1:${PORT}`, 'Content-Type': 'application/json' }, 'POST', '{"query":"x"}');
    assert.strictEqual(r.status, 401, 'unauthorized on /retrieve too');
    r = await rawRequest('/retrieve', { Host: `127.0.0.1:${PORT}`, 'Content-Type': 'application/json', Authorization: 'Bearer test-token-12345' }, 'POST', '{"query":"x"}');
    assert.strictEqual(r.status, 200, 'authorized /retrieve works');
  } finally {
    await stopServer(child);
  }
});

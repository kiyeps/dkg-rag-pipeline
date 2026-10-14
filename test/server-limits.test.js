// D2 integration: the request-body cap is enforced and never disables itself.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(root, 'src', 'cli.js');
const PORT = 18871;

function cleanEnv(extra = {}) {
  const e = { ...process.env };
  for (const k of ['DKG_RAG_HOST', 'DKG_RAG_TOKEN', 'DKG_RAG_MAX_BODY',
    'DKG_RAG_CORS_ORIGIN', 'EMBEDDING_API_URL', 'EMBEDDING_API_KEY',
    'EMBEDDING_MODEL', 'LLM_ENDPOINT']) delete e[k];
  return { ...e, DKG_RAG_PORT: String(PORT), ...extra };
}

function startServer(extraEnv = {}) {
  const child = spawn(process.execPath, [CLI, 'serve'], {
    env: cleanEnv(extraEnv), stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = { out: '', err: '' };
  child.stdout.on('data', d => { logs.out += d; });
  child.stderr.on('data', d => { logs.err += d; });
  return { child, logs };
}

async function waitHealth(timeoutMs = 45000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
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

function bigBody(bytes) {
  const overhead = '{"query":""}'.length; // 12
  const body = '{"query":"' + 'a'.repeat(bytes - overhead) + '"}';
  assert.strictEqual(Buffer.byteLength(body), bytes, 'fixture must be exactly ' + bytes + ' bytes');
  return body;
}

async function postRaw(body) {
  const r = await fetch(`http://127.0.0.1:${PORT}/retrieve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  return r.status;
}

test('limits: default 1 MiB cap rejects oversized bodies', async () => {
  const { child } = startServer();
  try {
    await waitHealth();
    assert.strictEqual(await postRaw(JSON.stringify({ query: 'small' })), 200);
    assert.strictEqual(await postRaw(bigBody(1048576 + 1)), 413);
  } finally { await stopServer(child); }
});

test('limits: DKG_RAG_MAX_BODY=abc falls back to the default (cap stays active)', async () => {
  const { child, logs } = startServer({ DKG_RAG_MAX_BODY: 'abc' });
  try {
    await waitHealth();
    assert.strictEqual(await postRaw(bigBody(1048576 + 1)), 413, 'cap must still enforce after invalid config');
    await new Promise(r => setTimeout(r, 400));
    assert.ok(logs.err.includes('DKG_RAG_MAX_BODY'), 'startup warning expected, got: ' + logs.err.slice(0, 200));
  } finally { await stopServer(child); }
});

test('limits: explicit 1000-byte cap enforces the boundary exactly', async () => {
  const { child } = startServer({ DKG_RAG_MAX_BODY: '1000' });
  try {
    await waitHealth();
    assert.strictEqual(await postRaw(bigBody(1000)), 200, 'exactly-at-cap allowed');
    assert.strictEqual(await postRaw(bigBody(1001)), 413, 'one byte over rejected');
  } finally { await stopServer(child); }
});

test('limits: zero is rejected as invalid and the default stays active', async () => {
  const { child, logs } = startServer({ DKG_RAG_MAX_BODY: '0' });
  try {
    await waitHealth();
    assert.strictEqual(await postRaw(bigBody(1048576 + 1)), 413);
    await new Promise(r => setTimeout(r, 400));
    assert.ok(logs.err.includes('DKG_RAG_MAX_BODY'));
  } finally { await stopServer(child); }
});

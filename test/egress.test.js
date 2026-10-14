// D3 regression tests: outbound provider egress (redaction + endpoint guard).
// Synthetic credentials only; all destinations are local fake servers.
import { test } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createProvider, OpenAICompatibleEmbeddingProvider,
  LocalEmbeddingProvider } from '../src/embedding.js';
import { DkgClient } from '../src/dkg-client.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(root, 'src', 'cli.js');

// Built from fragments so no credential-shaped literal appears in this file.
const HEX_KEY = '0x' + 'ab12'.repeat(16);
const FAKE_KEY = ['sk', 'synth', 'NOTREAL'].join('-');

function captureServer() {
  const captured = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      captured.push({ url: req.url, headers: req.headers, body });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }],
        answer: 'fake-answer',
      }));
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      resolve({ srv, captured, url: 'http://127.0.0.1:' + srv.address().port });
    });
  });
}

function setEnv(kv) {
  const prev = {};
  for (const [k, v] of Object.entries(kv)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
}

test('egress: embedding provider redacts secrets and carries the auth header', async () => {
  const fake = await captureServer();
  const restore = setEnv({
    EMBEDDING_API_URL: fake.url + '/v1/embeddings',
    EMBEDDING_API_KEY: FAKE_KEY,
    EMBEDDING_MODEL: 'test-model',
  });
  try {
    const p = createProvider();
    assert.ok(p instanceof OpenAICompatibleEmbeddingProvider, 'external provider must be selected');
    await p.embed('the key is ' + HEX_KEY + ' use it');
    assert.strictEqual(fake.captured.length, 1);
    const sent = JSON.parse(fake.captured[0].body);
    assert.ok(!sent.input.includes(HEX_KEY), 'raw secret must not leave the process');
    assert.ok(sent.input.includes('[REDACTED'), 'redaction marker expected');
    assert.strictEqual(fake.captured[0].headers.authorization, 'Bearer ' + FAKE_KEY);
  } finally {
    restore();
    fake.srv.close();
  }
});

test('egress: with no provider configured the local provider is used (no egress)', () => {
  const restore = setEnv({
    EMBEDDING_API_URL: undefined,
    EMBEDDING_API_KEY: undefined,
    EMBEDDING_MODEL: undefined,
  });
  try {
    const p = createProvider();
    assert.ok(p instanceof LocalEmbeddingProvider);
    assert.strictEqual(p.name, 'local-ngram');
  } finally { restore(); }
});

test('egress: /generate sends a redacted prompt to LLM_ENDPOINT', async () => {
  const fake = await captureServer();
  const PORT = 18881;
  const env = { ...process.env, DKG_RAG_PORT: String(PORT), LLM_ENDPOINT: fake.url + '/llm' };
  for (const k of ['DKG_RAG_HOST', 'DKG_RAG_TOKEN', 'EMBEDDING_API_URL', 'EMBEDDING_API_KEY', 'EMBEDDING_MODEL']) delete env[k];
  const child = spawn(process.execPath, [CLI, 'serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = { err: '' };
  child.stderr.on('data', d => { logs.err += d; });
  try {
    const t0 = Date.now();
    for (;;) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/health`);
        if (r.status === 200) break;
      } catch { /* not up */ }
      if (Date.now() - t0 > 45000) throw new Error('server did not start: ' + logs.err.slice(0, 300));
      await new Promise(r => setTimeout(r, 250));
    }
    const r = await fetch(`http://127.0.0.1:${PORT}/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'the key is ' + HEX_KEY }),
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fake.captured.length, 1, 'LLM endpoint must receive exactly one call');
    const sent = JSON.parse(fake.captured[0].body);
    assert.ok(!sent.prompt.includes(HEX_KEY), 'raw secret must not reach the LLM endpoint');
    assert.ok(sent.prompt.includes('[REDACTED'), 'redaction marker expected in the prompt');
  } finally {
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 8000);
      t.unref();
      child.once('exit', () => { clearTimeout(t); resolve(); });
      try { child.kill('SIGTERM'); } catch { clearTimeout(t); resolve(); }
    });
    fake.srv.close();
  }
});

test('egress: DKG client refuses http on non-loopback; remote override is explicit', () => {
  assert.throws(() => new DkgClient({ baseUrl: 'http://example.com', token: 'x' }), /https/);
  delete process.env.DKG_ALLOW_REMOTE_ENDPOINT;
  try {
    assert.throws(() => new DkgClient({ baseUrl: 'https://example.com', token: 'x' }),
      /DKG_ALLOW_REMOTE_ENDPOINT/);
    process.env.DKG_ALLOW_REMOTE_ENDPOINT = '1';
    const c = new DkgClient({ baseUrl: 'https://example.com', token: 'x' });
    assert.strictEqual(c.baseUrl, 'https://example.com');
  } finally {
    delete process.env.DKG_ALLOW_REMOTE_ENDPOINT;
  }
  const local = new DkgClient({ baseUrl: 'http://127.0.0.1:9200', token: 'x' });
  assert.strictEqual(local.baseUrl, 'http://127.0.0.1:9200');
});

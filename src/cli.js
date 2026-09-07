#!/usr/bin/env node
// dkg-rag CLI: ingest <file>, query <text>, serve, daemon

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Pipeline } from './pipeline.js';
import { DkgClient } from './dkg-client.js';
import { ChunkIndex } from './index.js';
import { createProvider } from './embedding.js';

function usage() {
  console.log(`Usage:
  dkg-rag ingest <file>      Ingest a document into DKG WM and local index
  dkg-rag query <text>        Retrieve top-k chunks for a query
  dkg-rag serve               Start HTTP server on port 8787 (GET /health, POST /retrieve, POST /generate)
  dkg-rag daemon              Same as serve (background-friendly)
`);
}

async function cmdIngest(file) {
  const pipeline = new Pipeline();
  const result = await pipeline.ingest(resolve(file));
  console.log(JSON.stringify(result, null, 2));
}

async function cmdQuery(text) {
  const pipeline = new Pipeline();
  pipeline.index.load();
  const results = await pipeline.retrieve(text);
  for (const r of results) {
    console.log(`[${r.score.toFixed(4)}] ${r.ual} — ${r.chunk.source} (chunk ${r.chunk.chunkIndex}/${r.chunk.totalChunks})`);
    console.log(`  ${r.chunk.text.slice(0, 200)}${r.chunk.text.length > 200 ? '...' : ''}`);
    console.log();
  }
}

async function cmdServe(port = 8787) {
  const pipeline = new Pipeline();
  pipeline.index.load();

  // Safe defaults: loopback-only bind, same-origin-ish CORS, no auth needed on loopback.
  // Remote exposure is explicit opt-in and requires a bearer token.
  const host = process.env.DKG_RAG_HOST || '127.0.0.1';
  const token = process.env.DKG_RAG_TOKEN || '';
  const exposed = host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
  if (exposed && !token) {
    console.error('Refusing to bind a non-loopback address without DKG_RAG_TOKEN set.');
    process.exit(1);
  }

  const server = createServer(async (req, res) => {
    // CORS: no wildcard. On loopback we reflect nothing (same-origin clients need no CORS);
    // in explicit exposed mode, reflect the Origin only if DKG_RAG_CORS_ORIGIN matches it.
    const origin = req.headers.origin;
    if (exposed && process.env.DKG_RAG_CORS_ORIGIN && origin === process.env.DKG_RAG_CORS_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Auth: required only in explicitly exposed mode.
    if (exposed) {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', indexSize: pipeline.index.size }));
      return;
    }

    if (req.method === 'POST' && req.url === '/retrieve') {
      try {
        const body = await readBody(req);
        const { query, k } = JSON.parse(body);
        const results = await pipeline.retrieve(query, { k: k || 5 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch (err) {
        const code = err.statusCode || 400;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/generate') {
      try {
        const body = await readBody(req);
        const { query, k } = JSON.parse(body);
        // Pluggable LLM: default echo (operator overrides via env or integration)
        const llmFn = async (prompt, citations) => {
          if (process.env.LLM_ENDPOINT) {
            const r = await fetch(process.env.LLM_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt }),
            });
            const data = await r.json();
            return data.answer || data.text || JSON.stringify(data);
          }
          return `[LLM not configured] Received prompt with ${citations.length} citations. Set LLM_ENDPOINT env to enable.`;
        };
        const result = await pipeline.generate(query, llmFn, { k: k || 5 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        const code = err.statusCode || 400;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(port, host, () => {
    const shown = host === '127.0.0.1' || host === '::1' ? `http://127.0.0.1:${port}` : `http://${host}:${port}`;
    console.log(`dkg-rag serving on ${shown} (bind: ${host})`);
    if (exposed) console.log('  mode: EXPOSED — bearer token required');
    console.log(`  GET  /health`);
    console.log(`  POST /retrieve  { "query": "...", "k": 5 }`);
    console.log(`  POST /generate  { "query": "...", "k": 5 }`);
  });
}

const MAX_BODY_BYTES = parseInt(process.env.DKG_RAG_MAX_BODY || '1048576', 10); // 1 MiB default

function readBody(req) {
  return new Promise((resolve, reject) => {
    // Enforce the limit on the raw byte stream BEFORE any buffering/parse.
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', c => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        req.removeAllListeners('data');
        reject(Object.assign(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', err => { if (!aborted) reject(err); });
  });
}

// Main
const [,, cmd, ...args] = process.argv;
try {
  switch (cmd) {
    case 'ingest':
      if (!args[0]) { console.error('Usage: dkg-rag ingest <file>'); process.exit(1); }
      await cmdIngest(args[0]);
      break;
    case 'query':
      if (!args[0]) { console.error('Usage: dkg-rag query <text>'); process.exit(1); }
      await cmdQuery(args.join(' '));
      break;
    case 'serve':
    case 'daemon':
      await cmdServe(parseInt(process.env.DKG_RAG_PORT || '8787', 10));
      break;
    default:
      usage();
      process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

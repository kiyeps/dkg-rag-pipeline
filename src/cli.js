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

  const server = createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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
        res.writeHead(400, { 'Content-Type': 'application/json' });
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
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(port, () => {
    console.log(`dkg-rag serving on http://127.0.0.1:${port}`);
    console.log(`  GET  /health`);
    console.log(`  POST /retrieve  { "query": "...", "k": 5 }`);
    console.log(`  POST /generate  { "query": "...", "k": 5 }`);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
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

#!/usr/bin/env node
// dkg-rag CLI: ingest <file>, query <text>, share <kaName>, serve, daemon

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Pipeline } from './pipeline.js';
import { redact } from './redaction.js';
import {
  hostnameOfHostHeader,
  isLoopbackHostname,
  originHostname,
  parseMaxBody,
  validateEndpointUrl,
} from './net-guard.js';

const DEFAULT_MAX_BODY = 1048576; // 1 MiB, documented default

function usage() {
  console.log(`Usage:
  dkg-rag ingest <file>       Ingest a document into DKG WM and local index
  dkg-rag query <text>        Retrieve top-k chunks for a query
  dkg-rag share <kaName>      Share a KA to Shared Working Memory (explicit; no automatic promotion)
  dkg-rag serve               Start HTTP server on 127.0.0.1:8787 (GET /health, POST /retrieve, POST /generate)
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
    const id = r.assertionUri || r.localKaName || '(no identifier)';
    console.log(`[${r.score.toFixed(4)}] ${id} - ${r.chunk.source} (chunk ${r.chunk.chunkIndex}/${r.chunk.totalChunks})`);
    console.log(`  ${r.chunk.text.slice(0, 200)}${r.chunk.text.length > 200 ? '...' : ''}`);
    console.log();
  }
}

async function cmdShare(kaName) {
  const pipeline = new Pipeline();
  const result = await pipeline.share(kaName);
  console.log(JSON.stringify(result, null, 2));
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Client errors carry safe, stable messages. Anything unexpected is logged to
// stderr only and answered as a sanitized 500.
function sendError(res, err) {
  const code = Number.isInteger(err && err.statusCode) ? err.statusCode : null;
  if (code && code < 500) {
    return sendJson(res, code, { error: err.message });
  }
  console.error(`[dkg-rag] internal error: ${err && err.message}`);
  return sendJson(res, 500, { error: 'internal error' });
}

function requireJsonContentType(req) {
  const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (ct !== 'application/json') {
    throw Object.assign(new Error('content-type must be application/json'), { statusCode: 415 });
  }
}

function parseJsonBody(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('invalid json body'), { statusCode: 400 });
  }
}

function requireQuery(query) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw Object.assign(new Error('query must be a non-empty string'), { statusCode: 400 });
  }
  return query;
}

const MAX_K = 50;

function optionalK(k) {
  if (k === undefined || k === null) return 5;
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) {
    throw Object.assign(new Error(`k must be an integer between 1 and ${MAX_K}`), { statusCode: 400 });
  }
  return k;
}

// DKG_RAG_MAX_BODY must be a positive integer (validated in net-guard.js).
// Invalid values fall back to the documented default with a warning; the cap
// is never disabled silently.
const MAX_BODY_BYTES = parseMaxBody(process.env.DKG_RAG_MAX_BODY, DEFAULT_MAX_BODY);

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
        // Drain the remainder so an oversized body is never buffered.
        req.resume();
        reject(Object.assign(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', err => { if (!aborted) reject(err); });
  });
}

async function cmdServe(port = 8787) {
  const pipeline = new Pipeline();
  pipeline.index.load();

  // Bind policy: loopback-only by default. Remote exposure is explicit opt-in
  // and always requires a bearer token.
  const host = process.env.DKG_RAG_HOST || '127.0.0.1';
  const token = process.env.DKG_RAG_TOKEN || '';
  const exposed = !isLoopbackHostname(host);
  if (exposed && !token) {
    console.error('Refusing to bind a non-loopback address without DKG_RAG_TOKEN set.');
    process.exit(1);
  }

  // Outbound LLM endpoint is validated once at startup; a bad configuration
  // stops the server instead of surfacing at request time.
  let llmEndpoint = null;
  try {
    llmEndpoint = validateEndpointUrl(process.env.LLM_ENDPOINT, { name: 'LLM_ENDPOINT' });
  } catch (err) {
    console.error(`LLM endpoint configuration error: ${err.message}`);
    process.exit(1);
  }

  const server = createServer(async (req, res) => {
    // CORS: no wildcard. On loopback nothing is reflected (same-origin clients
    // need no CORS); in explicit exposed mode the Origin is reflected only if
    // DKG_RAG_CORS_ORIGIN matches.
    const origin = req.headers.origin;
    if (exposed && process.env.DKG_RAG_CORS_ORIGIN && origin === process.env.DKG_RAG_CORS_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Loopback request-forgery guard. CORS response headers alone do not stop
    // a remote page from *executing* a simple cross-origin request against
    // this local service, so the Origin/Host boundary is enforced before any
    // handler runs.
    if (!exposed) {
      if (origin !== undefined) {
        const oh = originHostname(origin);
        if (!oh || !isLoopbackHostname(oh)) {
          return sendJson(res, 403, { error: 'cross-origin request rejected' });
        }
      }
      if (!req.headers.host) {
        return sendJson(res, 400, { error: 'host header required' });
      }
      const hh = hostnameOfHostHeader(req.headers.host);
      if (!isLoopbackHostname(hh)) {
        return sendJson(res, 403, { error: 'unexpected host rejected' });
      }
    }

    // Auth: required only in explicitly exposed mode, checked for every route.
    if (exposed) {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${token}`) {
        return sendJson(res, 401, { error: 'unauthorized' });
      }
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', indexSize: pipeline.index.size }));
      return;
    }

    if (req.method === 'POST' && (req.url === '/retrieve' || req.url === '/generate')) {
      try {
        requireJsonContentType(req);
        const body = await readBody(req);
        const parsed = parseJsonBody(body);
        const query = requireQuery(parsed && parsed.query);
        const k = optionalK(parsed && parsed.k);

        if (req.url === '/retrieve') {
          const results = await pipeline.retrieve(query, { k });
          return sendJson(res, 200, { results });
        }

        // Pluggable LLM: default echo (operator overrides via LLM_ENDPOINT).
        // The grounded prompt is redacted again before it leaves the process.
        const llmFn = async (prompt, citations) => {
          if (llmEndpoint) {
            const safePrompt = redact(prompt).text;
            const r = await fetch(llmEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: safePrompt }),
            });
            const data = await r.json();
            return data.answer || data.text || JSON.stringify(data);
          }
          return `[LLM not configured] Received prompt with ${citations.length} citations. Set LLM_ENDPOINT env to enable.`;
        };
        const result = await pipeline.generate(query, llmFn, { k });
        return sendJson(res, 200, result);
      } catch (err) {
        sendError(res, err);
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });

  server.listen(port, host, () => {
    const shown = isLoopbackHostname(host) ? `http://127.0.0.1:${port}` : `http://${host}:${port}`;
    console.log(`dkg-rag serving on ${shown} (bind: ${host})`);
    if (exposed) console.log('  mode: EXPOSED - bearer token required');
    console.log('  GET  /health');
    console.log('  POST /retrieve  { "query": "...", "k": 5 }');
    console.log('  POST /generate  { "query": "...", "k": 5 }');
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
    case 'share':
      if (!args[0]) { console.error('Usage: dkg-rag share <kaName>'); process.exit(1); }
      await cmdShare(args[0]);
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

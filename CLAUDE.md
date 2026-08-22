# CLAUDE.md — DKG RAG Pipeline

## Quick reference

- **Stack**: Node.js v24, ESM, zero deps, built-in fetch
- **Tests**: `node --test test/*.test.js`
- **CLI**: `node src/cli.js <ingest|query|serve|daemon>`
- **DKG node**: `http://127.0.0.1:9200`, auth from `~/.dkg/auth.token`

## Project structure

```
src/
  cli.js          — CLI: ingest, query, serve, daemon
  pipeline.js     — orchestrator (ingest → chunk → embed → WM write → index; retrieve; generate)
  dkg-client.js   — DKG HTTP client (create KA, write WM, share SWM, SPARQL query, status)
  chunker.js      — overlapping text chunker with metadata
  embedding.js    — pluggable embedding; local n-gram TF default, optional OpenAI-compatible
  index.js        — cosine-similarity index, JSON-persisted to .index/
  redaction.js    — secret redaction (hex keys, API tokens, secret lines, Solana heuristic)
test/
  chunker.test.js, embedding.test.js, index.test.js, redaction.test.js, quad-escaping.test.js
integrations/
  dkg-rag-pipeline.json — registry entry for dkg-integrations
```

## Critical rules

1. **Quads**: `{subject, predicate, object}` — NO per-quad `graph` field
2. **Subjects**: never `urn:dkg:file:*` or `urn:dkg:extraction:*`
3. **SPARQL literals**: always double-quoted (`"value"`)
4. **KA names**: use `freshKAName()` (timestamp suffix) to avoid seal errors
5. **Scope**: WM + SWM only. NO vm/publish. NO endorsement/voting.
6. **Redaction**: all secrets redacted before leaving process
7. **Language**: all file contents, comments, logs in English
8. **WM queries**: require `agentAddress` param

## DKG API endpoints used

- `POST /api/knowledge-assets` — create KA
- `POST /api/knowledge-assets/{name}/wm/write` — write quads to WM
- `POST /api/knowledge-assets/{name}/swm/share` — share to SWM (entities:"all")
- `POST /api/query` — SPARQL query (view param: wm/swm/vm)
- `GET /api/status` — node status

## Adding features

- New embedding provider: implement `embed(text)` and `embedBatch(texts)`, add to `createProvider()` factory
- New CLI command: add case in `cli.js` switch
- New test: add `test/<name>.test.js` using `node:test`

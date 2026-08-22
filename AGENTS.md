# AGENTS.md — DKG RAG Pipeline

## Project overview

Infra/retrieval layer: DKG V10 WM/SWM as the retrieval source for RAG. Substantively distinct from OpenClaw Memory Curator (curator daemon), DKG Memory MCP Server (transport layer), and Hermes bridge (agent-specific).

## Architecture

```
src/
  cli.js          — CLI entry point (ingest, query, serve, daemon)
  pipeline.js     — orchestrator: ingest / retrieve / generate
  dkg-client.js   — minimal DKG HTTP client (zero deps, built-in fetch)
  chunker.js      — overlapping text chunker
  embedding.js    — pluggable embedding (local n-gram TF default)
  index.js        — in-memory cosine-similarity index, JSON-persisted
  redaction.js    — secret redaction gate
test/
  *.test.js       — node:test unit tests
```

## Key constraints

- Zero or minimal deps. Node.js v24. ESM (`"type": "module"`).
- Quads: `{subject, predicate, object}` only. No per-quad graph field.
- Subjects must not use `urn:dkg:file:*` or `urn:dkg:extraction:*`.
- WM SPARQL view requires `agentAddress`; SWM/VM do not.
- SPARQL object literals must be double-quoted.
- Reusing a KA name → "partition differs" seal error; use `freshKAName()` with timestamp suffix.
- Round 1: WM + SWM only. NO vm/publish. NO endorsement/voting.
- All contents in English. Redact secrets before they leave the process.

## DKG node facts

- Daemon: `http://127.0.0.1:9200`
- Auth: line 2 of `~/.dkg/auth.token` (strip `#` comment lines)
- Default context graph: `openclaw-curator`

## Running tests

```bash
node --test test/*.test.js
```

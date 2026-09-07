# Design Brief — DKG RAG Pipeline

DKG V10 Round 1 submission (`cfi-dkgv10-r1`). Companion to `integrations/dkg-rag-pipeline.json`.

## Problem

LLM applications need grounded generation over an agent's memory. DKG V10 Working
Memory already stores provenance-tagged knowledge; what's missing is vector-style
retrieval with citations back to the exact Knowledge Assets.

## Design

`dkg-rag` is a CLI + optional local HTTP service:

- **Ingest**: chunk a document; write each chunk as a provenance-tagged KA to WM.
- **Index**: local cosine-similarity index over chunk embeddings (persisted JSON;
  character n-gram TF fallback needs zero external API keys; optional
  OpenAI-compatible embedding provider via env).
- **Retrieve**: embed query → rank chunks → return top-k with DKG KA UALs as citations.
- **Generate**: feed retrieved chunks to a pluggable LLM with DKG provenance grounding.

## Security posture (hardened 2026-09-08)

- The HTTP service binds **127.0.0.1 only by default**. Remote exposure requires
  explicit `DKG_RAG_HOST` + `DKG_RAG_TOKEN`; without a token, exposed endpoints
  return 401. CORS is same-origin by default (no wildcard reflection).
- Request bodies are capped (default 1 MiB, `DKG_RAG_MAX_BODY`); oversized
  requests are rejected with 413 before buffering (streaming counter).
- Secret redaction runs before any literal leaves the process.

## Demo

`docs/demo-transcript.txt` — recorded against a live local DKG V10 node
(v10.0.15, Base Sepolia testnet, context graph `openclaw-curator`):
ingest → query returning the chunk with its UAL citation.

## Maintenance

Maintained by @kiyeps. Support window: 6 months post-merge minimum.

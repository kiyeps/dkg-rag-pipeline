# DKG RAG Pipeline

Retrieval-Augmented Generation pipeline that uses DKG V10 Working/Shared
Memory as a vector-searchable knowledge source. Ingests documents into DKG
memory (as provenance-tagged Knowledge Assets), indexes them for semantic
retrieval, and serves ranked chunks to any LLM for grounded generation.

Fourth submission to the DKG v10 Call for Integrations (Round 1: Working +
Shared Memory). Substantively distinct from:
- OpenClaw Memory Curator (PR #26): OpenClaw-specific memory-file curator daemon
- DKG Memory MCP Server (PR #27): transport-agnostic MCP tooling layer
- Hermes DKG Memory Bridge: Hermes-agent-specific action audit trail

This one is an infra/retrieval layer: WM/SWM as the retrieval source for RAG,
directly serving the bounty's LLM-Wiki / Autoresearch theme.

## What it does

1. **Ingest** — chunk documents, write each chunk as a provenance-tagged KA to
   DKG WM (with source, chunk index, embedding reference).
2. **Index** — compute embeddings per chunk; store the embedding + a pointer to
   the DKG KA. Local FAISS or simple cosine index (no external vector DB
   required).
3. **Retrieve** — given a query, embed it, rank chunks by similarity, return the
   top-k with their DKG KA UALs as citation.
4. **Generate** — feed retrieved chunks to an LLM (pluggable provider) with the
   DKG provenance as grounding; answers cite their DKG sources.
5. **Maturity** — chunks retrieved frequently auto-promote to SWM (sealed).

## Runtime facts (verified 2026-08-22)

- DKG daemon: http://127.0.0.1:9200 (v10.0.13, testnet Base Sepolia)
- Auth token: line 2 of ~/.dkg/auth.token (line 1 is a comment — strip `#` lines)
- Default context graph: openclaw-curator
- Quads format: JSON array of {subject, predicate, object} — NO per-quad graph field
- WM SPARQL view requires agentAddress; SWM/VM views do not
- Reserved subject IRIs urn:dkg:file:* and urn:dkg:extraction:* are REJECTED
- Full swm/share (entities:"all") seals by default => publish-ready
- SPARQL object literals must be double-quoted ("value")
- Reusing a KA name with different data → "partition differs" seal error; use timestamp suffix

## Constraints

- All file contents, comments, logs in English.
- Secret redaction before any literal leaves the process.
- Round 1 scope: WM + SWM only. NO vm/publish. NO endorsement/voting tools.
- Embeddings: use a lightweight local model if possible (e.g. a small ONNX/transformers
  model) OR a pluggable provider interface with a no-op/local fallback so the
  pipeline runs without external API keys. Do NOT hardcode a paid API as required.
- Zero or minimal deps. node:test for tests.
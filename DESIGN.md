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
   the DKG KA. In-memory cosine index persisted as JSON (no external vector DB;
   zero runtime dependencies).
3. **Retrieve** — given a query, embed it, rank chunks by similarity, return the
   top-k with node-issued assertion URIs and view hints as citations
   (identifiers come from the node, never constructed locally).
4. **Generate** — feed retrieved chunks to an LLM (pluggable provider) with the
   DKG provenance as grounding; answers cite their DKG sources.
5. **Share (explicit only)** — `dkg-rag share <ka>` promotes a document to SWM
   (sealed). No automatic promotion and no daemon exist in this implementation.

## Runtime facts (live local node, Base Sepolia testnet)

- DKG daemon: http://127.0.0.1:9200 (v10.0.19, testnet Base Sepolia)
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
- Embeddings: pluggable provider with a fully local default (character n-gram
  TF vector, zero external calls). Optional OpenAI-compatible endpoint via
  EMBEDDING_API_URL; non-loopback hosts require https + explicit opt-in
  (DKG_ALLOW_REMOTE_ENDPOINT=1). No paid API is required or hardcoded.
- Zero or minimal deps. node:test for tests.
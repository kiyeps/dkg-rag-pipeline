# DKG RAG Pipeline

Retrieval-Augmented Generation pipeline using DKG V10 Working/Shared Memory as a vector-searchable knowledge source with provenance citations.

## What it does

1. **Ingest** — chunk documents, write each chunk as a provenance-tagged Knowledge Asset to DKG WM
2. **Index** — compute embeddings per chunk; store the embedding + pointer to the DKG KA (local cosine index, no external vector DB)
3. **Retrieve** — embed a query, rank chunks by similarity, return top-k with the node-issued assertion URIs as citations
4. **Generate** — feed retrieved chunks to a pluggable LLM with DKG provenance as grounding

## Quick start

```bash
# Ingest a document
dkg-rag ingest ./my-doc.txt

# Query the index
dkg-rag query "what is distributed knowledge?"

# Serve HTTP API
dkg-rag serve   # http://127.0.0.1:8787
```

## HTTP API

| Method | Path        | Body                              | Description              |
|--------|-------------|-----------------------------------|--------------------------|
| GET    | /health     | —                                 | Health check + index size|
| POST   | /retrieve   | `{ "query": "...", "k": 5 }`     | Semantic retrieval       |
| POST   | /generate   | `{ "query": "...", "k": 5 }`     | RAG generation           |

## Embedding

Default: local character n-gram TF vector (deterministic, zero API keys). Optional: set `EMBEDDING_API_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL` for an OpenAI-compatible provider.

## Configuration

| Env var                | Default              | Description                    |
|------------------------|----------------------|--------------------------------|
| `DKG_API_URL`          | `http://127.0.0.1:9200` | DKG node base URL          |
| `DKG_CONTEXT_GRAPH_ID` | `openclaw-curator`   | Context graph for KAs          |
| `DKG_AGENT_ADDRESS`    | —                    | Peer ID for WM SPARQL queries  |
| `DKG_RAG_PORT`         | `8787`               | HTTP server port               |
| `LLM_ENDPOINT`         | —                    | Optional LLM for /generate     |

Auth token: line 2 of `~/.dkg/auth.token` (lines starting with `#` are stripped).

## Constraints

- Round 1 scope: WM + SWM only. No vm/publish. No endorsement/voting.
- All file contents, comments, logs in English.
- Secret redaction before any literal leaves the process.
- Quads: `{subject, predicate, object}` — no per-quad graph field.
- Subjects never use reserved `urn:dkg:file:*` / `urn:dkg:extraction:*`.

## Testing

```bash
node --test test/*.test.js
```

## License

Apache-2.0

## Verified example (2026-08-22)

Real ingest + retrieval against the local DKG node (v10.0.19, testnet):

```bash
dkg-rag ingest /tmp/rag/sample.md
# {"kaName": "dkg-rag-mt4arb4z-xqid", "chunks": 1, "redactedCount": 0}

dkg-rag query "Torch refund reserve corruption"
# [0.5489] dkg://openclaw-curator/dkg-rag-mt4arb4z-xqid — /tmp/rag/sample.md (chunk 0/1)
#   # Torch Finance Audit Summary (2026-08-22)
#   TORCH-1 was hypothesized as a refunded-pool-operation reserve corruption bug.
#   ...
```

A document was chunked, embedded, stored as a Knowledge Asset, and retrieved
by a natural-language query with a similarity score and a `dkg://` provenance
URI pointing back at the source asset.

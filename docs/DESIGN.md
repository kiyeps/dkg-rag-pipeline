# Design Brief - dkg-rag-pipeline

DKG V10 Call for Integrations, Round 1 submission (`cfi-dkgv10-r1`). Human-readable
companion to `integrations/dkg-rag-pipeline.json`.

## Problem

Agents and applications that ground answers in their own documents need retrieval
with provenance. File-based RAG cannot answer "which source, owned by whom, sealed
when, at which Merkle root". DKG V10 already stores knowledge as provenance-tagged
Knowledge Assets; this pipeline makes that store directly retrievable so every
retrieved chunk can cite a node-issued identifier instead of a local file path.

Target users: agent builders (OpenClaw, Hermes, any CLI) and developers who want a
verifiable citation trail behind generated answers.

## Layers touched

- Working Memory (WM): primary write and read target. Documents are ingested as
  KAs (draft-open in WM); the local chunk index mirrors WM state.
- Shared Working Memory (SWM): explicit promotion target. `dkg-rag share <ka>`
  calls swm/share (seals by default) and makes a document publish-ready.
- Verifiable Memory (VM): NOT used in Round 1. No vm/publish code path exists.

## DKG V10 interfaces and primitives used

- Context Graph: `openclaw-curator` by default (override with DKG_CONTEXT_GRAPH).
  The WM query view requires agentAddress; the SWM view does not.
- Knowledge Asset: one KA per ingested document (`dkg-rag-<epoch>-<pid>`), written
  through POST /api/knowledge-assets -> wm/write -> wm/finalize.
- Assertion: wm/finalize seals the draft assertion. The node returns the canonical
  assertionUri (`did:dkg:context-graph:<cg>/assertion/0x.../<name>`), the Merkle
  root, and the chain id; the pipeline stores all three with every chunk record
  and returns them on every retrieval. If finalize is unavailable, records keep
  the draft assertionUri returned by create and are marked as draft - identifiers
  are never invented locally.
- SubGraph: not used. No subgraph admin operations are performed; documents land
  directly in the context graph.
- Operations used: create KA, wm/write, wm/finalize, swm/share, POST /api/query
  (SPARQL over wm/shared views). No publish, no endorse/verify/update.

## How this advances LLM-Wiki and autoresearch

LLM-Wiki needs a durable, provenance-carrying knowledge store that both humans and
agents can cite; autoresearch needs retrieval whose sources remain auditable after
the fact. This pipeline turns DKG memory into the retrieval substrate: a
researcher's notes become a KA whose sealed assertion URI travels with every
citation, so a generated answer can be re-verified against the exact sealed
revision instead of a mutable file. Any agent framework can query it over one HTTP
call (`dkg-rag serve`) or embed the CLI.

## Terminology (v10 vocabulary)

- "Ingest" = create KA + wm/write + wm/finalize (no share).
- "Share" = the DKG SHARE operation (POST .../swm/share). The word "publish" is
  never used for this; PUBLISH (vm/publish) is out of Round 1 scope.
- "Retrieve" = local cosine search over the embedding index; results carry WM/SWM
  view hints plus the node-issued identifiers above.

## Promotion path (current behavior)

1. Ingest writes a draft assertion in WM; the KA stays in WM.
2. The operator explicitly runs `dkg-rag share <ka-name>` -> swm/share with
   entities:"all" (seals the assertion by default, publish-ready).
3. Nothing is automatic: no daemon, no timer, no auto-share. VM promotion does not
   exist in this submission. The local chunk index is a retrieval accelerator
   only; DKG remains the source of truth for identifiers.

## Provenance, identifiers, and oracle input

- Every chunk record stores kaName + assertionUri + merkleRoot + chainId + the WM
  view hint, taken verbatim from the node's finalize response.
- Citations returned by /retrieve and /generate are these node-issued assertion
  URIs, so downstream verification (fetch the assertion, check the Merkle root)
  does not need to trust this pipeline.
- Context oracles: retrieval output has exactly the shape an oracle consumes -
  assertion URI plus a sealed root. Sharing a KA to SWM makes it eligible as a
  candidate input for context-oracle workflows; this pipeline does not call
  oracles itself.
- Legacy index entries without a stored assertionUri return assertionUri:null
  rather than a fabricated identifier.

## Security posture

- Credentials: DKG auth token from DKG_AUTH_TOKEN env or ~/.dkg/auth.token
  (line 2, comment lines stripped). Never logged, never sent anywhere except the
  configured DKG node.
- Egress: loopback-only by default - the DKG node (http://127.0.0.1:9200) and
  nothing else. Optional operator-configured providers: EMBEDDING_API_URL and
  LLM_ENDPOINT. Non-loopback endpoints must be https and require explicit opt-in
  (DKG_ALLOW_REMOTE_ENDPOINT=1); they are declared in the registry entry. The
  default embedding provider is fully local (character n-gram TF vector), so a
  default install makes zero external calls.
- Redaction: every text and every quad passes the secret redaction gate before it
  is embedded, sent to a provider, or written to DKG; the same gate runs on
  /generate prompts before they reach an LLM endpoint. Provider auth keys never
  appear in any outbound payload.
- Write authority: wm/write + swm/share only.
- Server hardening: the HTTP server binds loopback by default and rejects (403)
  requests whose Host header is not loopback (DNS-rebinding guard) and requests
  with a foreign Origin (CSRF guard); it enforces a 1 MiB request-body cap
  (env-tunable DKG_RAG_MAX_BODY; invalid values fall back to the documented
  default), requires Content-Type: application/json, rejects malformed JSON with
  400, and requires a bearer token (401) whenever the operator binds a
  non-loopback host.
- Dependencies: zero runtime dependencies; Node.js >= 20 (developed and tested on
  v24).

## Tests and demo

- `node --test test/*.test.js` - unit tests plus HTTP integration tests
  (loopback/Origin/Host guards, body-cap boundary, egress redaction regression).
- Demo: `docs/demo-transcript.txt`, recorded against a live local DKG V10 node
  (Base Sepolia testnet).

## Maintainer

@kiyeps (https://github.com/kiyeps) - 6 months post-merge support minimum.

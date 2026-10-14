// DKG RAG Pipeline orchestrator.
// ingest(document) -> chunk -> embed -> write KA quads to DKG WM -> finalize ->
//                     persist the node-issued assertion URI + index chunks
// retrieve(query) -> embed -> search -> ranked chunks with the KA's assertion URI
// generate(query, llmFn) -> retrieve + call pluggable LLM fn with grounded context
// share(kaName) -> explicit SWM share (no automatic promotion exists)

import { readFileSync } from 'node:fs';
import { chunkText } from './chunker.js';
import { createProvider } from './embedding.js';
import { ChunkIndex } from './index.js';
import { DkgClient, sparqlLiteral } from './dkg-client.js';
import { redact, redactQuads } from './redaction.js';

const NS = 'urn:dkg:rag';

// Wrap an object value as an RDF quoted literal for DKG WM writes.
function rdfLiteral(value) {
  return sparqlLiteral(value);
}

export class Pipeline {
  constructor({ dkgClient, index, embeddingProvider, contextGraphId, agentAddress } = {}) {
    // The DKG client is created lazily: server-only flows (retrieve/generate)
    // must not require a local auth token to exist.
    this._dkg = dkgClient || null;
    this.index = index || new ChunkIndex();
    this.embedder = embeddingProvider || createProvider();
    this.contextGraphId = contextGraphId || process.env.DKG_CONTEXT_GRAPH_ID || 'openclaw-curator';
    this.agentAddress = agentAddress || process.env.DKG_AGENT_ADDRESS || '';
  }

  get dkg() {
    if (!this._dkg) this._dkg = new DkgClient();
    return this._dkg;
  }

  // Ingest a document: read file, chunk, embed, write to DKG WM, finalize,
  // persist the node-issued assertion URI locally, index.
  async ingest(filePath, { source } = {}) {
    const text = readFileSync(filePath, 'utf-8');
    const { text: safeText } = redact(text);
    const src = source || filePath;
    const chunks = chunkText(safeText, { source: src });
    const kaName = this.dkg.freshKAName('dkg-rag');

    // Build quads for all chunks (raw objects first, redact, then quote)
    const rawQuads = [];
    for (const c of chunks) {
      const subj = `${NS}:chunk:${kaName}:${c.chunkIndex}`;
      rawQuads.push({ subject: subj, predicate: `${NS}:text`, object: c.text });
      rawQuads.push({ subject: subj, predicate: `${NS}:source`, object: c.source });
      rawQuads.push({ subject: subj, predicate: `${NS}:chunkIndex`, object: String(c.chunkIndex) });
      rawQuads.push({ subject: subj, predicate: `${NS}:totalChunks`, object: String(c.totalChunks) });
    }

    // Redact quads before quoting
    const { quads: redactedQuads, redactedCount } = redactQuads(rawQuads);
    if (redactedCount > 0) {
      console.log(`[pipeline] redacted ${redactedCount} secret(s) before WM write`);
    }

    // Now wrap objects as RDF quoted literals
    const quads = redactedQuads.map(q => ({
      subject: q.subject,
      predicate: q.predicate,
      object: rdfLiteral(q.object),
    }));

    // Create KA, write quads to WM, finalize to obtain the canonical
    // assertion URI issued by the node (never constructed locally).
    const created = await this.dkg.createKnowledgeAsset(kaName);
    await this.dkg.writeWM(kaName, quads);
    let finalized = null;
    try {
      finalized = await this.dkg.finalizeWM(kaName);
    } catch (err) {
      console.error(`[pipeline] wm/finalize failed for ${kaName}: ${err.message}`);
    }
    const assertionUri = (finalized && finalized.assertionUri)
      || (created && created.assertionUri)
      || null;

    // Embed chunks and index
    const embeddings = await this.embedder.embedBatch(chunks.map(c => c.text));
    const kaRef = { kaName, contextGraphId: this.contextGraphId, assertionUri };
    for (let i = 0; i < chunks.length; i++) {
      this.index.add(chunks[i], embeddings[i], kaRef);
    }
    this.index.save();

    return {
      kaName,
      assertionUri,
      chunks: chunks.length,
      redactedCount,
      contextGraphId: this.contextGraphId,
    };
  }

  // Retrieve: redact + embed the query, search the index, return ranked chunks.
  // Each result carries the node-issued assertion URI when the KA has one, and
  // the local KA name so callers can always show an honest identifier.
  async retrieve(query, { k = 5 } = {}) {
    const { text: safeQuery } = redact(query);
    const qEmbedding = await this.embedder.embed(safeQuery);
    const results = this.index.search(qEmbedding, k);
    return results.map(r => ({
      ...r,
      assertionUri: (r.kaRef && r.kaRef.assertionUri) || null,
      localKaName: (r.kaRef && r.kaRef.kaName) || null,
    }));
  }

  // Generate: retrieve + call pluggable LLM fn with grounded context + citations.
  async generate(query, llmFn, { k = 5 } = {}) {
    const { text: safeQuery } = redact(query);
    const results = await this.retrieve(safeQuery, { k });
    const context = results.map((r, i) => {
      const id = r.assertionUri || r.localKaName || 'unknown';
      return `[${i + 1}] (source: ${r.chunk.source}, asset: ${id}, score: ${r.score.toFixed(4)})\n${r.chunk.text}`;
    }).join('\n\n');

    const prompt = `Answer the following question using the provided context. Cite sources using [N] notation.

Context:
${context}

Question: ${safeQuery}

Answer:`;

    const answer = await llmFn(prompt, results);
    return {
      answer,
      citations: results.map(r => ({
        assertionUri: r.assertionUri,
        localKaName: r.localKaName,
        source: r.chunk.source,
        score: r.score,
      })),
    };
  }

  // Explicit SWM share: the only promotion path that exists. There is no
  // automatic promotion; the operator must invoke this deliberately.
  async share(kaName, { entities = 'all' } = {}) {
    return this.dkg.shareSWM(kaName, { entities });
  }
}

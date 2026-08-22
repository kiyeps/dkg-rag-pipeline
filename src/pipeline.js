// DKG RAG Pipeline orchestrator.
// ingest(document) -> chunk -> embed -> write KAs to DKG WM -> index
// retrieve(query) -> embed -> search -> fetch chunk text from DKG WM -> ranked chunks with KA UALs
// generate(query, llmFn) -> retrieve + call pluggable LLM fn with grounded context + citations

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
    this.dkg = dkgClient || new DkgClient();
    this.index = index || new ChunkIndex();
    this.embedder = embeddingProvider || createProvider();
    this.contextGraphId = contextGraphId || process.env.DKG_CONTEXT_GRAPH_ID || 'openclaw-curator';
    this.agentAddress = agentAddress || process.env.DKG_AGENT_ADDRESS || '';
  }

  // Ingest a document: read file, chunk, embed, write to DKG WM, index locally.
  async ingest(filePath, { source } = {}) {
    const text = readFileSync(filePath, 'utf-8');
    const { text: safeText } = redact(text);
    const src = source || filePath;
    const chunks = chunkText(safeText, { source: src });
    const kaName = this.dkg.freshKAName('dkg-rag');

    // Build quads for all chunks (raw objects first, redact, then quote)
    const rawQuads = [];
    const chunkMeta = [];
    for (const c of chunks) {
      const subj = `${NS}:chunk:${kaName}:${c.chunkIndex}`;
      rawQuads.push({ subject: subj, predicate: `${NS}:text`, object: c.text });
      rawQuads.push({ subject: subj, predicate: `${NS}:source`, object: c.source });
      rawQuads.push({ subject: subj, predicate: `${NS}:chunkIndex`, object: String(c.chunkIndex) });
      rawQuads.push({ subject: subj, predicate: `${NS}:totalChunks`, object: String(c.totalChunks) });
      chunkMeta.push({ subj, chunk: c });
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

    // Create KA and write to WM
    await this.dkg.createKnowledgeAsset(kaName);
    await this.dkg.writeWM(kaName, quads);

    // Embed chunks and index
    const embeddings = await this.embedder.embedBatch(chunks.map(c => c.text));
    const kaRef = { kaName, contextGraphId: this.contextGraphId };
    for (let i = 0; i < chunks.length; i++) {
      this.index.add(chunks[i], embeddings[i], kaRef);
    }
    this.index.save();

    return {
      kaName,
      chunks: chunks.length,
      redactedCount,
      contextGraphId: this.contextGraphId,
    };
  }

  // Retrieve: embed query, search index, return ranked chunks with DKG KA UALs.
  async retrieve(query, { k = 5 } = {}) {
    const qEmbedding = await this.embedder.embed(query);
    const results = this.index.search(qEmbedding, k);
    return results.map(r => ({
      ...r,
      ual: `dkg://${r.kaRef.contextGraphId}/${r.kaRef.kaName}`,
    }));
  }

  // Generate: retrieve + call pluggable LLM fn with grounded context + citations.
  async generate(query, llmFn, { k = 5 } = {}) {
    const results = await this.retrieve(query, { k });
    const context = results.map((r, i) =>
      `[${i + 1}] (source: ${r.chunk.source}, UAL: ${r.ual}, score: ${r.score.toFixed(4)})\n${r.chunk.text}`
    ).join('\n\n');

    const prompt = `Answer the following question using the provided context. Cite sources using [N] notation.

Context:
${context}

Question: ${query}

Answer:`;

    const answer = await llmFn(prompt, results);
    return { answer, citations: results.map(r => ({ ual: r.ual, source: r.chunk.source, score: r.score })) };
  }
}

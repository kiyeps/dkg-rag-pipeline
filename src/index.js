// In-memory cosine-similarity index over chunk embeddings, persisted to JSON.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export class ChunkIndex {
  constructor({ persistDir } = {}) {
    this.persistDir = persistDir || join(process.cwd(), '.index');
    this.entries = []; // { id, chunk, embedding, kaRef }
    this._nextId = 1;
  }

  add(chunk, embedding, kaRef) {
    const id = this._nextId++;
    this.entries.push({ id, chunk, embedding, kaRef });
    return id;
  }

  search(queryEmbedding, k = 5) {
    const scored = this.entries.map(e => ({
      id: e.id,
      chunk: e.chunk,
      kaRef: e.kaRef,
      score: cosineSim(queryEmbedding, e.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  get size() {
    return this.entries.length;
  }

  save() {
    if (!existsSync(this.persistDir)) mkdirSync(this.persistDir, { recursive: true });
    const data = {
      nextId: this._nextId,
      entries: this.entries.map(e => ({
        id: e.id,
        chunk: e.chunk,
        embedding: e.embedding,
        kaRef: e.kaRef,
      })),
    };
    writeFileSync(join(this.persistDir, 'chunks.json'), JSON.stringify(data, null, 2));
  }

  load() {
    const p = join(this.persistDir, 'chunks.json');
    if (!existsSync(p)) return;
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    this._nextId = data.nextId || 1;
    this.entries = data.entries || [];
  }
}

export { cosineSim };

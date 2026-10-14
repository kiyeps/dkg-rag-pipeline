// Pluggable embedding provider interface.
// Default: LOCAL fallback using character n-gram TF vector (deterministic, zero API keys).
// Optional: OpenAI-compatible provider via env (EMBEDDING_API_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL).

import { createHash } from 'node:crypto';
import { redact } from './redaction.js';
import { validateEndpointUrl } from './net-guard.js';

const DIMENSION = 128;
const N = 3; // character trigrams

// Deterministic hash-bucket embedding: character n-gram TF mapped to fixed dim via hashing.
function localEmbed(text) {
  const vec = new Float64Array(DIMENSION);
  if (!text || text.length === 0) return vec;
  const lower = text.toLowerCase();
  for (let i = 0; i <= lower.length - N; i++) {
    const gram = lower.slice(i, i + N);
    const h = createHash('sha256').update(gram).digest();
    const bucket = (h.readUInt32BE(0)) % DIMENSION;
    vec[bucket] += 1;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < DIMENSION; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIMENSION; i++) vec[i] /= norm;
  return vec;
}

export class LocalEmbeddingProvider {
  constructor() {
    this.dimension = DIMENSION;
    this.name = 'local-ngram';
  }
  async embed(text) {
    return Array.from(localEmbed(text));
  }
  async embedBatch(texts) {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}

export class OpenAICompatibleEmbeddingProvider {
  constructor({ apiUrl, apiKey, model }) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.dimension = null; // discovered on first call
    this.name = 'openai-compatible';
  }
  async embed(text) {
    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      // Defense in depth: redact secret-shaped spans before any text
      // leaves the process toward an external provider.
      body: JSON.stringify({ input: redact(text).text, model: this.model }),
    });
    if (!res.ok) throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const vec = data.data[0].embedding;
    this.dimension = vec.length;
    return vec;
  }
  async embedBatch(texts) {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}

export function createProvider() {
  const apiUrl = process.env.EMBEDDING_API_URL;
  const apiKey = process.env.EMBEDDING_API_KEY;
  const model = process.env.EMBEDDING_MODEL;
  if (apiUrl && apiKey && model) {
    // Normalize + validate: non-loopback providers must be https.
    const normalized = validateEndpointUrl(apiUrl, { name: 'EMBEDDING_API_URL' });
    return new OpenAICompatibleEmbeddingProvider({ apiUrl: normalized, apiKey, model });
  }
  return new LocalEmbeddingProvider();
}

export { localEmbed, DIMENSION };

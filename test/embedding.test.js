import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localEmbed, DIMENSION, createProvider, LocalEmbeddingProvider } from '../src/embedding.js';

describe('embedding (local fallback)', () => {
  it('produces deterministic embeddings', () => {
    const a = localEmbed('hello world');
    const b = localEmbed('hello world');
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i], b[i]);
    }
  });

  it('produces unit-length vectors (L2 normalized)', () => {
    const v = localEmbed('some test text for normalization check');
    let sum = 0;
    for (const x of v) sum += x * x;
    assert.ok(Math.abs(sum - 1.0) < 1e-9, `L2 norm should be 1, got ${Math.sqrt(sum)}`);
  });

  it('different texts produce different embeddings', () => {
    const a = localEmbed('hello world');
    const b = localEmbed('goodbye universe');
    let same = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) { same = false; break; }
    }
    assert.ok(!same, 'different texts should produce different embeddings');
  });

  it('empty text returns zero vector', () => {
    const v = localEmbed('');
    for (const x of v) assert.equal(x, 0);
  });

  it('dimension is 128', () => {
    assert.equal(DIMENSION, 128);
    const v = localEmbed('test');
    assert.equal(v.length, 128);
  });

  it('createProvider returns LocalEmbeddingProvider by default', () => {
    const p = createProvider();
    assert.ok(p instanceof LocalEmbeddingProvider);
  });

  it('LocalEmbeddingProvider.embed returns array', async () => {
    const p = new LocalEmbeddingProvider();
    const v = await p.embed('test');
    assert.ok(Array.isArray(v));
    assert.equal(v.length, DIMENSION);
  });

  it('embedBatch returns array of arrays', async () => {
    const p = new LocalEmbeddingProvider();
    const vs = await p.embedBatch(['hello', 'world']);
    assert.equal(vs.length, 2);
    assert.ok(Array.isArray(vs[0]));
    assert.ok(Array.isArray(vs[1]));
  });
});

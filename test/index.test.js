import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChunkIndex, cosineSim } from '../src/index.js';
import { localEmbed } from '../src/embedding.js';

describe('index (cosine ranking)', () => {
  it('cosineSim of identical vectors is 1', () => {
    const v = [1, 0, 0];
    assert.ok(Math.abs(cosineSim(v, v) - 1.0) < 1e-9);
  });

  it('cosineSim of orthogonal vectors is 0', () => {
    assert.ok(Math.abs(cosineSim([1, 0], [0, 1])) < 1e-9);
  });

  it('cosineSim of opposite vectors is -1', () => {
    assert.ok(Math.abs(cosineSim([1, 0], [-1, 0]) + 1.0) < 1e-9);
  });

  it('ranks similar chunks higher', () => {
    const idx = new ChunkIndex({ persistDir: '/tmp/dkg-rag-test-index-' + Date.now() });
    const e1 = localEmbed('machine learning algorithms');
    const e2 = localEmbed('cooking recipes for pasta');
    const e3 = localEmbed('deep learning neural networks');

    idx.add({ text: 'ML doc' }, e1, { kaName: 'ka1' });
    idx.add({ text: 'Cooking doc' }, e2, { kaName: 'ka2' });
    idx.add({ text: 'DL doc' }, e3, { kaName: 'ka3' });

    const query = localEmbed('machine learning models');
    const results = idx.search(query, 3);
    // ML and DL should rank above cooking
    assert.equal(results[0].chunk.text, 'ML doc');
    assert.ok(results[0].score > results[1].score);
  });

  it('returns top-k results', () => {
    const idx = new ChunkIndex({ persistDir: '/tmp/dkg-rag-test-index2-' + Date.now() });
    for (let i = 0; i < 10; i++) {
      idx.add({ text: `chunk ${i}` }, localEmbed(`text number ${i}`), { kaName: `ka${i}` });
    }
    const results = idx.search(localEmbed('text'), 3);
    assert.equal(results.length, 3);
  });

  it('returns fewer than k if not enough entries', () => {
    const idx = new ChunkIndex({ persistDir: '/tmp/dkg-rag-test-index3-' + Date.now() });
    idx.add({ text: 'only one' }, localEmbed('only one'), { kaName: 'ka1' });
    const results = idx.search(localEmbed('one'), 5);
    assert.equal(results.length, 1);
  });

  it('persists and loads from disk', () => {
    const dir = '/tmp/dkg-rag-test-persist-' + Date.now();
    const idx1 = new ChunkIndex({ persistDir: dir });
    idx1.add({ text: 'hello' }, localEmbed('hello'), { kaName: 'ka1' });
    idx1.save();

    const idx2 = new ChunkIndex({ persistDir: dir });
    idx2.load();
    assert.equal(idx2.size, 1);
    assert.equal(idx2.entries[0].chunk.text, 'hello');
  });
});

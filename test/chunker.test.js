import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../src/chunker.js';

describe('chunker', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(chunkText(''), []);
    assert.deepEqual(chunkText('', { source: 'x' }), []);
  });

  it('returns single chunk for short text', () => {
    const chunks = chunkText('hello world', { chunkSize: 500, overlap: 100 });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, 'hello world');
    assert.equal(chunks[0].chunkIndex, 0);
    assert.equal(chunks[0].totalChunks, 1);
    assert.equal(chunks[0].source, 'unknown');
  });

  it('produces overlapping chunks', () => {
    const text = 'a'.repeat(1000);
    const chunks = chunkText(text, { chunkSize: 500, overlap: 100, source: 'test.txt' });
    assert.ok(chunks.length > 1, `expected >1 chunks, got ${chunks.length}`);
    // First chunk starts at 0
    assert.equal(chunks[0].charStart, 0);
    // Second chunk starts at step = 500-100 = 400
    assert.equal(chunks[1].charStart, 400);
    // Overlap region: chars 400..499 are in both chunk 0 and chunk 1
    assert.ok(chunks[0].charEnd > chunks[1].charStart);
    // All chunks have source set
    for (const c of chunks) {
      assert.equal(c.source, 'test.txt');
      assert.equal(c.totalChunks, chunks.length);
    }
  });

  it('sets totalChunks correctly', () => {
    const text = 'x'.repeat(1500);
    const chunks = chunkText(text, { chunkSize: 500, overlap: 100 });
    for (const c of chunks) {
      assert.equal(c.totalChunks, chunks.length);
    }
  });

  it('throws on invalid params', () => {
    assert.throws(() => chunkText('hi', { chunkSize: 0 }), /chunkSize must be > 0/);
    assert.throws(() => chunkText('hi', { chunkSize: 100, overlap: -1 }), /overlap must be >= 0/);
    assert.throws(() => chunkText('hi', { chunkSize: 100, overlap: 100 }), /overlap must be < chunkSize/);
  });

  it('covers entire text (last chunk reaches end)', () => {
    const text = 'abcdefghijklmnop';
    const chunks = chunkText(text, { chunkSize: 5, overlap: 2 });
    const last = chunks[chunks.length - 1];
    assert.equal(last.charEnd, text.length);
  });
});

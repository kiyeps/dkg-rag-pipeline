// D4 regression tests: citations carry the node-issued assertion URI, never a
// locally constructed identifier; legacy entries are labelled honestly.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pipeline } from '../src/pipeline.js';
import { ChunkIndex } from '../src/index.js';
import { LocalEmbeddingProvider } from '../src/embedding.js';

const HEX_KEY = '0x' + 'ab12'.repeat(16);

class FakeDkg {
  constructor() {
    this.calls = [];
    this.finalizeError = null;
    this.finalizeResult = {
      assertionUri: 'did:dkg:context-graph:test-cg/assertion/0xAbC/ka-final',
    };
  }
  async createKnowledgeAsset(name) {
    this.calls.push(['create', name]);
    return {
      name,
      assertionUri: 'did:dkg:context-graph:test-cg/_working_memory/0xAbC/77',
      status: 'draft-open',
    };
  }
  async writeWM(name, quads) {
    this.calls.push(['write', name, quads.length]);
    return { written: quads.length };
  }
  async finalizeWM(name) {
    this.calls.push(['finalize', name]);
    if (this.finalizeError) throw new Error(this.finalizeError);
    return this.finalizeResult;
  }
  async shareSWM(name, opts) {
    this.calls.push(['share', name, opts]);
    return { swmShared: true, promotedCount: 1 };
  }
  freshKAName(prefix) {
    return prefix + '-TESTFIXED';
  }
}

function makePipe(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dkgrag-id-'));
  const index = new ChunkIndex({ persistDir: dir });
  const fake = new FakeDkg();
  const pipe = new Pipeline({
    dkgClient: fake,
    index,
    embeddingProvider: new LocalEmbeddingProvider(),
    contextGraphId: 'test-cg',
    ...extra,
  });
  return { dir, index, fake, pipe };
}

test('D4: ingest persists the finalize assertionUri into the index', async () => {
  const { dir, pipe, fake } = makePipe();
  const doc = join(dir, 'doc.md');
  writeFileSync(doc, '# notes\nalpha beta gamma delta epsilon zeta eta theta\n');
  const res = await pipe.ingest(doc);
  assert.strictEqual(res.assertionUri, fake.finalizeResult.assertionUri);
  assert.ok(fake.calls.some(c => c[0] === 'finalize'), 'finalize must be called');
  const persisted = JSON.parse(readFileSync(join(dir, 'chunks.json'), 'utf8'));
  assert.ok(persisted.entries.length >= 1);
  assert.strictEqual(persisted.entries[0].kaRef.assertionUri, fake.finalizeResult.assertionUri);
});

test('D4: retrieve surfaces assertionUri + localKaName; legacy rows stay honest', async () => {
  const { index, pipe, fake } = makePipe();
  const dir2 = mkdtempSync(join(tmpdir(), 'dkgrag-legacy-'));
  const legacyIndex = new ChunkIndex({ persistDir: dir2 });
  legacyIndex.add(
    { text: 'legacy chunk text', source: 'old.md', chunkIndex: 0, totalChunks: 1 },
    new Array(8).fill(0.5),
    { kaName: 'legacy-ka', contextGraphId: 'test-cg' },
  );
  const legacyPipe = new Pipeline({
    dkgClient: fake,
    index: legacyIndex,
    embeddingProvider: new LocalEmbeddingProvider(),
    contextGraphId: 'test-cg',
  });
  const legacy = await legacyPipe.retrieve('legacy chunk', { k: 1 });
  assert.strictEqual(legacy.length, 1);
  assert.strictEqual(legacy[0].assertionUri, null, 'legacy KA has no node-issued URI');
  assert.strictEqual(legacy[0].localKaName, 'legacy-ka');
  assert.ok(pipe.index.size === 0, 'fresh pipe starts empty');
  assert.ok(index.size === 0);
});

test('D4: finalize failure falls back to the draft assertionUri from create', async () => {
  const { dir, pipe, fake } = makePipe();
  fake.finalizeError = 'simulated finalize failure';
  const doc = join(dir, 'doc2.md');
  writeFileSync(doc, 'beta gamma delta epsilon\n');
  const res = await pipe.ingest(doc);
  assert.strictEqual(res.assertionUri,
    'did:dkg:context-graph:test-cg/_working_memory/0xAbC/77');
});

test('D4: share is explicit and calls swm/share with entities=all by default', async () => {
  const { pipe, fake } = makePipe();
  const res = await pipe.share('ka-share-me');
  assert.deepStrictEqual(fake.calls, [['share', 'ka-share-me', { entities: 'all' }]]);
  assert.strictEqual(res.swmShared, true);
});

test('D3: query text is redacted before it reaches the embedder', async () => {
  const { pipe } = makePipe();
  class Recorder {
    constructor() { this.inputs = []; }
    async embed(t) { this.inputs.push(t); return new Array(8).fill(0.5); }
    async embedBatch(ts) { return ts.map(() => new Array(8).fill(0.5)); }
  }
  const rec = new Recorder();
  const p2 = new Pipeline({
    dkgClient: new FakeDkg(),
    index: new ChunkIndex({ persistDir: mkdtempSync(join(tmpdir(), 'dkgrag-rec-')) }),
    embeddingProvider: rec,
    contextGraphId: 'test-cg',
  });
  await p2.retrieve('the key is ' + HEX_KEY + ' okay', { k: 1 });
  assert.strictEqual(rec.inputs.length, 1);
  assert.ok(!rec.inputs[0].includes(HEX_KEY), 'raw hex key must not reach the embedder');
  assert.ok(rec.inputs[0].includes('[REDACTED'), 'redaction marker expected');
  assert.ok(pipe.index.size === 0);
});

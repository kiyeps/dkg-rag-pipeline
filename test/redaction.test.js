import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactQuads } from '../src/redaction.js';

describe('redaction', () => {
  it('returns unchanged text when no secrets', () => {
    const r = redact('hello world, nothing secret here');
    assert.equal(r.text, 'hello world, nothing secret here');
    assert.equal(r.count, 0);
  });

  it('redacts hex private keys', () => {
    const input = 'key = 0x' + 'a'.repeat(64);
    const r = redact(input);
    assert.ok(r.text.includes('[REDACTED:hex-private-key]'));
    assert.ok(r.count >= 1);
  });

  it('redacts API tokens with known prefixes', () => {
    const r1 = redact('my token is sk-abcdefghij1234567890 here');
    assert.ok(r1.text.includes('[REDACTED:api-token]'));

    const r2 = redact('ghp_abcdefghijklmnopqrstuvwxyz1234');
    assert.ok(r2.text.includes('[REDACTED:api-token]'));
  });

  it('redacts key=value lines with secret flags', () => {
    const r = redact('private_key=supersecretvalue');
    assert.ok(r.text.includes('[REDACTED:secret-line]'));
  });

  it('handles empty and non-string input', () => {
    assert.deepEqual(redact(''), { text: '', count: 0 });
    assert.deepEqual(redact(null), { text: null, count: 0 });
    assert.deepEqual(redact(undefined), { text: undefined, count: 0 });
  });

  it('redactQuads redacts object fields only', () => {
    const quads = [
      { subject: 'urn:test:s1', predicate: 'urn:test:p1', object: 'normal text' },
      { subject: 'urn:test:s2', predicate: 'urn:test:p2', object: 'sk-abcdefghij1234567890' },
    ];
    const r = redactQuads(quads);
    assert.equal(r.quads[0].object, 'normal text');
    assert.ok(r.quads[1].object.includes('[REDACTED:api-token]'));
    assert.equal(r.redactedCount, 1);
    // Subject and predicate unchanged
    assert.equal(r.quads[1].subject, 'urn:test:s2');
    assert.equal(r.quads[1].predicate, 'urn:test:p2');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sparqlLiteral } from '../src/dkg-client.js';

describe('quad escaping (SPARQL literals)', () => {
  it('wraps value in double quotes', () => {
    assert.equal(sparqlLiteral('hello'), '"hello"');
  });

  it('escapes inner double quotes', () => {
    assert.equal(sparqlLiteral('say "hi"'), '"say \\"hi\\""');
  });

  it('escapes backslashes', () => {
    assert.equal(sparqlLiteral('a\\b'), '"a\\\\b"');
  });

  it('escapes newlines', () => {
    assert.equal(sparqlLiteral('line1\nline2'), '"line1\\nline2"');
  });

  it('escapes carriage returns', () => {
    assert.equal(sparqlLiteral('a\rb'), '"a\\rb"');
  });

  it('handles combined escapes', () => {
    const result = sparqlLiteral('a"b\\c\nd');
    assert.equal(result, '"a\\"b\\\\c\\nd"');
  });

  it('handles empty string', () => {
    assert.equal(sparqlLiteral(''), '""');
  });

  it('converts non-string to string', () => {
    assert.equal(sparqlLiteral(42), '"42"');
    assert.equal(sparqlLiteral(true), '"true"');
  });
});

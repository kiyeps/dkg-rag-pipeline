// D1/D2 unit tests: loopback boundary helpers + strict body-cap parsing.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  normalizeHostname,
  isLoopbackHostname,
  hostnameOfHostHeader,
  originHostname,
  validateEndpointUrl,
  parseMaxBody,
} from '../src/net-guard.js';

test('net-guard: loopback hostnames are recognized', () => {
  for (const h of ['127.0.0.1', '127.0.0.2', '127.255.255.254', 'localhost',
    'LOCALHOST', '::1', '[::1]', '::ffff:127.0.0.1', ' localhost ']) {
    assert.strictEqual(isLoopbackHostname(h), true, h + ' should be loopback');
  }
});

test('net-guard: non-loopback hostnames are rejected', () => {
  for (const h of ['example.com', 'localhost.evil.com', '127.0.0.1.evil.com',
    '192.168.1.3', '10.0.0.1', '::ffff:10.0.0.1', '', null, undefined]) {
    assert.strictEqual(isLoopbackHostname(h), false, String(h) + ' must NOT be loopback');
  }
});

test('net-guard: Host header hostname extraction (ports + brackets)', () => {
  assert.strictEqual(hostnameOfHostHeader('127.0.0.1:8787'), '127.0.0.1');
  assert.strictEqual(hostnameOfHostHeader('localhost'), 'localhost');
  assert.strictEqual(hostnameOfHostHeader('[::1]:8787'), '::1');
  assert.strictEqual(hostnameOfHostHeader('evil.com:80'), 'evil.com');
  assert.strictEqual(hostnameOfHostHeader(''), '');
});

test('net-guard: Origin hostname extraction; sandboxed null yields null', () => {
  assert.strictEqual(originHostname('http://127.0.0.1:3000'), '127.0.0.1');
  assert.strictEqual(originHostname('https://evil.com'), 'evil.com');
  assert.strictEqual(originHostname('null'), null);
  assert.strictEqual(originHostname('not a url'), null);
});

test('net-guard: validateEndpointUrl requires https for non-loopback', () => {
  assert.throws(() => validateEndpointUrl('http://example.com/v1', { name: 'X' }), /https/);
  assert.strictEqual(validateEndpointUrl('https://example.com/v1', { name: 'X' }),
    'https://example.com/v1');
  assert.throws(() => validateEndpointUrl('ftp://example.com', { name: 'X' }), /http\(s\)/);
});

test('net-guard: remote opt-in env gates non-loopback endpoints', () => {
  delete process.env.DKG_ALLOW_REMOTE_ENDPOINT;
  try {
    assert.throws(() => validateEndpointUrl('https://example.com/v1',
      { name: 'X', remoteOptInEnv: 'DKG_ALLOW_REMOTE_ENDPOINT' }), /DKG_ALLOW_REMOTE_ENDPOINT/);
    process.env.DKG_ALLOW_REMOTE_ENDPOINT = '1';
    assert.strictEqual(validateEndpointUrl('https://example.com/v1',
      { name: 'X', remoteOptInEnv: 'DKG_ALLOW_REMOTE_ENDPOINT' }), 'https://example.com/v1');
  } finally {
    delete process.env.DKG_ALLOW_REMOTE_ENDPOINT;
  }
});

test('net-guard: loopback http endpoints pass; empty input returns null', () => {
  assert.strictEqual(validateEndpointUrl('http://127.0.0.1:9200', { name: 'X' }),
    'http://127.0.0.1:9200');
  assert.strictEqual(validateEndpointUrl('', { name: 'X' }), null);
  assert.strictEqual(validateEndpointUrl(undefined, { name: 'X' }), null);
});

test('net-guard: parseMaxBody validates strictly, never disables the cap', () => {
  const quiet = () => {};
  assert.strictEqual(parseMaxBody(undefined, 100, quiet), 100);
  assert.strictEqual(parseMaxBody('', 100, quiet), 100);
  assert.strictEqual(parseMaxBody('2048', 100, quiet), 2048);
  assert.strictEqual(parseMaxBody('1', 100, quiet), 1);
  for (const bad of ['abc', '0', '-5', '3.5', '1e999', 'NaN', 'Infinity']) {
    assert.strictEqual(parseMaxBody(bad, 100, quiet), 100, bad + ' must fall back to default');
  }
  let warned = 0;
  parseMaxBody('abc', 100, () => { warned += 1; });
  assert.strictEqual(warned, 1, 'invalid value must warn exactly once');
});

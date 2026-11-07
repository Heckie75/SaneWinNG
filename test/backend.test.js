'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHost, validateHosts, capabilities } = require('../src/backend');

test('parses server addresses with optional ports', () => {
  assert.deepEqual(parseHost('scanner.local'), { host: 'scanner.local', port: 6566 });
  assert.deepEqual(parseHost('192.168.1.10:12345'), { host: '192.168.1.10', port: 12345 });
  assert.deepEqual(parseHost('[::1]:6567'), { host: '::1', port: 6567 });
  assert.deepEqual(validateHosts(['scanner.local', 'scanner.local']), ['scanner.local']);
});

test('rejects invalid endpoints and scanners not belonging to configured servers', async () => {
  for (const host of ['', 'example.com:0', 'example.com:65536', 'example.com;echo', '[not-ipv6]:123', 'host:123:456']) assert.throws(() => parseHost(host));
  const id = Buffer.from(JSON.stringify({ endpoint: 'other.local', name: 'test:0' })).toString('base64url');
  await assert.rejects(capabilities(id, ['scanner.local']), /configured server/);
});
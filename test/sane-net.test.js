'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const { SaneClient, word, string } = require('../src/sane-net');
const { PNG } = require('pngjs');
const { encodeFrames } = require('../src/sane-image');

test('lists devices using SANE network protocol on a custom port', async () => {
  const server = net.createServer((socket) => {
    let stage = 0;
    let buffer = Buffer.alloc(0);
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (stage === 0 && buffer.length >= 12 && buffer.length >= 12 + buffer.readUInt32BE(8)) {
        assert.equal(buffer.readUInt32BE(0), 0);
        buffer = buffer.subarray(12 + buffer.readUInt32BE(8));
        stage = 1;
        socket.write(Buffer.concat([word(0), word(0x01000003)]));
      }
      if (stage === 1 && buffer.length >= 4) {
        assert.equal(buffer.readUInt32BE(0), 1);
        stage = 2;
        const reply = Buffer.concat([word(0), word(2), word(0), string('test:0'), string('Example'), string('Scanner'), string('flatbed'), word(1)]);
        socket.write(reply.subarray(0, 5));
        socket.write(reply.subarray(5));
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const client = await SaneClient.connect('127.0.0.1', server.address().port);
    assert.deepEqual(await client.listDevices(), [{ name: 'test:0', vendor: 'Example', model: 'Scanner', type: 'flatbed' }]);
    client.close();
  } finally { server.close(); }
});

test('encodes grayscale and planar color scan frames', () => {
  const gray = encodeFrames([{ params: { format: 0, width: 2, lines: 1, bytesPerLine: 2, depth: 8 }, data: Buffer.from([0, 255]) }]);
  assert.deepEqual([...PNG.sync.read(gray).data], [0, 0, 0, 255, 255, 255, 255, 255]);
  const frames = [2, 3, 4].map((format) => ({ params: { format, width: 1, lines: 1, bytesPerLine: 1, depth: 8 }, data: Buffer.from([format * 30]) }));
  assert.deepEqual([...PNG.sync.read(encodeFrames(frames)).data], [60, 90, 120, 255]);
});

test('decodes one-bit lineart and sixteen-bit byte order', () => {
  const lineart = encodeFrames([{ params: { format: 0, width: 2, lines: 1, bytesPerLine: 1, depth: 1 }, data: Buffer.from([0x80]) }]);
  assert.deepEqual([...PNG.sync.read(lineart).data], [0, 0, 0, 255, 255, 255, 255, 255]);
  for (const [byteOrder, data] of [[0x1234, [0x34, 0x12]], [0x4321, [0x12, 0x34]]]) {
    const image = encodeFrames([{ params: { format: 0, width: 1, lines: 1, bytesPerLine: 2, depth: 16 }, data: Buffer.from(data), byteOrder }]);
    assert.deepEqual([...PNG.sync.read(image).data], [0x12, 0x12, 0x12, 255]);
  }
});

test('rejects incomplete or oversized scan frames', () => {
  assert.throws(() => encodeFrames([{ params: { format: 2, width: 1, lines: 1, bytesPerLine: 1, depth: 8 }, data: Buffer.from([0]) }]), /incomplete/);
  assert.throws(() => encodeFrames([{ params: { format: 0, width: 70000, lines: 70000, bytesPerLine: 70000, depth: 8 }, data: Buffer.alloc(0) }]), /oversized/);
});

test('allows an advertised source even when its reported size omits the terminator', async () => {
  const { SaneClient } = require('../src/sane-net');
  const client = Object.create(SaneClient.prototype);
  let sent;
  const words = [0, 0, 3, 8, 8];
  client.handle = 1;
  client.wire = { send: (...parts) => { sent = Buffer.concat(parts); }, word: async () => words.shift(), read: async () => Buffer.from('Flatbed\0'), string: async () => null };
  const option = { index: 3, name: 'source', type: 3, size: 7, values: ['Flatbed'] };
  assert.equal((await client.control(option, 'Flatbed')).value, 'Flatbed');
  assert.equal(sent.readUInt32BE(20), 8);
  assert.equal(sent.subarray(28).toString(), 'Flatbed\0');
  await assert.rejects(client.control(option, 'Not listed'), /Invalid source/);
});

test('reports scan transfer progress within large records', async () => {
  const client = Object.create(SaneClient.prototype);
  const words = [70000, 0xffffffff];
  let closed = false;
  const data = { wire: { word: async () => words.shift(), read: async (size) => size === 1 ? Buffer.from([5]) : Buffer.alloc(size), socket: { destroy: () => { closed = true; } } } };
  const progress = [];
  const pixels = await client.readFrame(data, (received) => progress.push(received));
  assert.equal(pixels.length, 70000);
  assert.deepEqual(progress, [65536, 70000]);
  assert.equal(closed, true);
});

test('reads and writes complete numeric option vectors', async () => {
  const client = Object.create(SaneClient.prototype);
  client.handle = 1;
  const words = [0, 0, 1, 12, 3, 0, 32768, 65535];
  let sent;
  client.wire = { send: (...parts) => { sent = Buffer.concat(parts); }, word: async () => words.shift(), string: async () => null };
  const option = { index: 4, name: 'gamma-table', type: 1, size: 12 };
  assert.deepEqual((await client.control(option, [0, 32768, 65535])).value, [0, 32768, 65535]);
  assert.deepEqual([sent.readUInt32BE(28), sent.readUInt32BE(32), sent.readUInt32BE(36)], [0, 32768, 65535]);
  await assert.rejects(client.control(option, [1]), /Invalid gamma-table/);
});
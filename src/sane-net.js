'use strict';

const net = require('node:net');
const { once } = require('node:events');

const MAX_STRING = 1024 * 1024;
const MAX_ITEMS = 16384;

function word(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function string(value) {
  if (value === null) return word(0);
  const bytes = Buffer.from(`${value}\0`, 'utf8');
  return Buffer.concat([word(bytes.length), bytes]);
}

class Wire {
  constructor(socket, timeout = 15000) {
    this.socket = socket;
    this.iterator = socket[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    socket.setTimeout(timeout, () => socket.destroy(new Error('SANE server timed out.')));
  }

  async read(size) {
    while (this.buffer.length < size) {
      const { value, done } = await this.iterator.next();
      if (done) throw new Error('SANE server closed the connection unexpectedly.');
      this.buffer = Buffer.concat([this.buffer, value]);
    }
    const result = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return result;
  }

  async word() { return (await this.read(4)).readUInt32BE(); }

  async string() {
    const length = await this.word();
    if (length > MAX_STRING) throw new Error('SANE server sent an oversized string.');
    if (!length) return null;
    const data = await this.read(length);
    if (data[length - 1] !== 0) throw new Error('SANE server sent an invalid string.');
    return data.subarray(0, -1).toString('utf8');
  }

  send(...parts) { this.socket.write(Buffer.concat(parts)); }
}

function checkStatus(status) {
  const messages = ['Success', 'Operation unsupported', 'Operation canceled', 'Device busy', 'Invalid value', 'End of scan', 'Document feeder jammed', 'No documents in feeder', 'Scanner cover open', 'Scanner I/O error', 'Out of memory', 'Access denied'];
  if (status !== 0) {
    const error = new Error(messages[status] || `SANE server returned status ${status}.`);
    error.saneStatus = status;
    throw error;
  }
}

class SaneClient {
  constructor(socket, signal) { this.wire = new Wire(socket); this.signal = signal; }

  static async connect(host, port = 6566, signal) {
    const socket = net.createConnection({ host, port, signal });
    socket.setTimeout(10000, () => socket.destroy(new Error('SANE server connection timed out.')));
    try {
      await once(socket, 'connect');
      const client = new SaneClient(socket, signal);
      client.wire.send(word(0), word(0x01000003), string('sanewin'));
      checkStatus(await client.wire.word());
      const version = await client.wire.word();
      if ((version >>> 24) !== 1 || ![2, 3].includes(version & 0xffff)) throw new Error('Unsupported SANE network protocol version.');
      return client;
    } catch (error) { socket.destroy(); throw error; }
  }

  async listDevices() {
    this.wire.send(word(1));
    checkStatus(await this.wire.word());
    const count = await this.wire.word();
    if (count > MAX_ITEMS) throw new Error('SANE server sent too many devices.');
    const devices = [];
    for (let index = 0; index < count; index++) {
      if (await this.wire.word()) continue;
      const name = await this.wire.string();
      const vendor = await this.wire.string();
      const model = await this.wire.string();
      const type = await this.wire.string();
      if (name) devices.push({ name, vendor, model, type });
    }
    return devices;
  }

  async open(name) {
    this.wire.send(word(2), string(name));
    const status = await this.wire.word();
    const handle = await this.wire.word();
    const resource = await this.wire.string();
    if (resource) throw new Error('This SANE server requires authentication, which is not supported.');
    checkStatus(status);
    this.handle = handle;
  }

  async options() {
    this.wire.send(word(4), word(this.handle));
    const count = await this.wire.word();
    if (count > MAX_ITEMS) throw new Error('SANE server sent too many options.');
    const options = [];
    for (let index = 0; index < count; index++) {
      if (await this.wire.word()) { options.push(null); continue; }
      const option = { index, name: await this.wire.string(), title: await this.wire.string(), description: await this.wire.string(), type: await this.wire.word(), unit: await this.wire.word(), size: await this.wire.word(), cap: await this.wire.word(), constraint: await this.wire.word() };
      if (option.size > MAX_STRING) throw new Error('SANE option is too large.');
      if (option.constraint === 1) {
        if (!(await this.wire.word())) option.range = { min: await this.wire.word(), max: await this.wire.word(), step: await this.wire.word() };
      } else if (option.constraint === 2 || option.constraint === 3) {
        const length = await this.wire.word();
        if (length > MAX_ITEMS) throw new Error('SANE server sent too many option values.');
        option.values = [];
        for (let item = 0; item < length; item++) option.values.push(option.constraint === 2 ? await this.wire.word() : await this.wire.string());
        if (option.constraint === 2) option.values.shift();
        else option.values = option.values.filter((value) => value !== null);
      } else if (option.constraint !== 0) throw new Error('SANE server sent an unknown option constraint.');
      options.push(option);
    }
    return options;
  }

  async control(option, value) {
    const setting = value !== undefined;
    const size = setting && option.type === 3 ? Buffer.byteLength(value, 'utf8') + 1 : option.size;
    let data;
    if (option.type === 3) {
      const bytes = setting ? Buffer.from(`${value}\0`) : Buffer.alloc(size);
      if (bytes.length > MAX_STRING || (bytes.length > option.size && (!setting || !option.values?.includes(value)))) throw new Error(`Invalid ${option.name} value.`);
      data = Buffer.concat([word(bytes.length), bytes]);
    } else {
      if (size % 4 !== 0 || size > MAX_STRING) throw new Error('Unsupported SANE option size.');
      const values = Array(size / 4).fill(0);
      if (setting) {
        const input = Array.isArray(value) ? value : [value];
        if (input.length !== values.length || input.some((item) => !Number.isFinite(Number(item)))) throw new Error(`Invalid ${option.name} value.`);
        input.forEach((item, index) => { values[index] = option.type === 2 ? Math.round(Number(item) * 65536) : Number(item); });
      }
      data = Buffer.concat([word(values.length), ...values.map(word)]);
    }
    this.wire.send(word(5), word(this.handle), word(option.index), word(setting ? 1 : 0), word(option.type), word(size), data);
    const status = await this.wire.word();
    const info = await this.wire.word();
    const type = await this.wire.word();
    const valueSize = await this.wire.word();
    const length = await this.wire.word();
    if (valueSize > MAX_STRING || length > MAX_STRING || (type !== 3 && length > MAX_STRING / 4)) throw new Error('SANE server sent an oversized option value.');
    let result;
    if (type === 3) {
      const bytes = await this.wire.read(length);
      result = bytes.subarray(0, Math.max(0, bytes.indexOf(0) === -1 ? bytes.length : bytes.indexOf(0))).toString('utf8');
    } else {
      const values = [];
      for (let index = 0; index < length; index++) values.push((await this.wire.word()) | 0);
      const decoded = type === 2 ? values.map((item) => item / 65536) : values;
      result = decoded.length === 1 ? decoded[0] : decoded;
    }
    const resource = await this.wire.string();
    if (resource) throw new Error('This SANE server requires authentication, which is not supported.');
    checkStatus(status);
    return { value: result, info };
  }

  async parameters() {
    this.wire.send(word(6), word(this.handle));
    const status = await this.wire.word();
    const params = { format: await this.wire.word(), last: await this.wire.word(), bytesPerLine: await this.wire.word(), width: await this.wire.word(), lines: (await this.wire.word()) | 0, depth: await this.wire.word() };
    checkStatus(status);
    return params;
  }

  async start() {
    this.wire.socket.setTimeout(120000);
    this.wire.send(word(7), word(this.handle));
    const status = await this.wire.word();
    const port = await this.wire.word();
    const byteOrder = await this.wire.word();
    const resource = await this.wire.string();
    if (resource) throw new Error('This SANE server requires authentication, which is not supported.');
    checkStatus(status);
    if (port < 1 || port > 65535) throw new Error('SANE server returned an invalid data port.');
    const socket = net.createConnection({ host: this.wire.socket.remoteAddress, port, signal: this.signal });
    socket.setTimeout(30000, () => socket.destroy(new Error('SANE scan data connection timed out.')));
    try { await once(socket, 'connect'); } catch (error) { socket.destroy(); throw error; }
    return { wire: new Wire(socket, 120000), byteOrder };
  }

  async readFrame(data, onProgress) {
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const length = await data.wire.word();
        if (length === 0xffffffff) {
          const status = (await data.wire.read(1))[0];
          if (status !== 5) checkStatus(status);
          return Buffer.concat(chunks, total);
        }
        if (length === 0) continue;
        if (total + length > 250 * 1024 * 1024) throw new Error('Scan exceeded the 250 MB limit.');
        let remaining = length;
        while (remaining > 0) {
          const chunk = await data.wire.read(Math.min(remaining, 64 * 1024));
          chunks.push(chunk);
          total += chunk.length;
          remaining -= chunk.length;
          onProgress?.(total);
        }
      }
    } finally { data.wire.socket.destroy(); }
  }

  async closeDevice() {
    if (this.handle === undefined) return;
    this.wire.send(word(3), word(this.handle));
    await this.wire.word();
    this.handle = undefined;
  }

  async cancel() {
    this.wire.send(word(8), word(this.handle));
    await this.wire.word();
  }

  close() { if (this.signal?.aborted) this.wire.socket.destroy(); else this.wire.socket.end(word(10)); }
}

module.exports = { SaneClient, Wire, word, string, checkStatus, MAX_ITEMS };
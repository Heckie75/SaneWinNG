'use strict';

const net = require('node:net');
const { spawn } = require('node:child_process');
const { Bonjour } = require('bonjour-service');
const { SaneClient } = require('./sane-net');
const { encodeFrames } = require('./sane-image');

const ADVANCED_OPTIONS = ['custom-gamma', 'gamma-table', 'red-gamma-table', 'green-gamma-table', 'blue-gamma-table', 'brightness', 'contrast', 'lamp-off-time', 'lamp-off-scan', 'color-filter'];

function parseHost(value) {
  if (typeof value !== 'string' || value.length > 260) throw new Error('Invalid network host.');
  const match = value.match(/^(?:\[([a-fA-F0-9:.]+)\]|([a-zA-Z0-9.-]+))(?::(\d{1,5}))?$/);
  if (!match) throw new Error('Use a hostname or IP address, optionally followed by :port.');
  const host = match[1] || match[2];
  const port = match[3] ? Number(match[3]) : 6566;
  if ((match[1] && net.isIP(host) !== 6) || port < 1 || port > 65535 || (!match[1] && !net.isIP(host) && !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))) throw new Error('Invalid network host or port.');
  return { host, port };
}

function validateHosts(hosts) {
  if (!Array.isArray(hosts) || hosts.length > 100) throw new Error('Invalid network hosts.');
  hosts.forEach(parseHost);
  return [...new Set(hosts)];
}

async function discoverHosts() {
  return new Promise((resolve, reject) => {
    const hosts = new Set();
    let browser; let bonjour; let timer;
    const fail = (error) => { clearTimeout(timer); browser?.stop(); bonjour?.destroy(); reject(error); };
    try {
      bonjour = new Bonjour();
      bonjour.server.mdns.on('error', fail);
      timer = setTimeout(() => { browser?.stop(); bonjour.destroy(); resolve([...hosts]); }, 3000);
      browser = bonjour.find({ type: 'sane-port', protocol: 'tcp' }, (service) => {
        const host = service.addresses?.find((address) => net.isIP(address) === 4) || service.addresses?.find((address) => net.isIP(address) === 6) || service.host?.replace(/\.$/, '');
        if (!host || !Number.isInteger(service.port)) return;
        const address = net.isIP(host) === 6 ? `[${host}]` : host;
        const endpoint = service.port === 6566 ? address : `${address}:${service.port}`;
        try { parseHost(endpoint); hosts.add(endpoint); } catch {}
      });
    } catch (error) { fail(error); }
  });
}

function encodeDevice(endpoint, name) { return Buffer.from(JSON.stringify({ endpoint, name })).toString('base64url'); }

function decodeDevice(id, hosts) {
  if (typeof id !== 'string' || id.length > 8192) throw new Error('Invalid scanner.');
  let device;
  try { device = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')); } catch { throw new Error('Invalid scanner.'); }
  if (!device || !hosts.includes(device.endpoint) || typeof device.name !== 'string' || !device.name || device.name.length > 4096) throw new Error('Scanner does not belong to a configured server.');
  return device;
}

async function listDevices(hosts) {
  const endpoints = validateHosts(hosts);
  const results = await Promise.allSettled(endpoints.map(async (endpoint) => {
    const { host, port } = parseHost(endpoint);
    const client = await SaneClient.connect(host, port);
    try {
      return (await client.listDevices()).map((device) => ({ id: encodeDevice(endpoint, device.name), name: [device.vendor, device.model, device.type].filter(Boolean).join(' ') || device.name, endpoint, device: device.name }));
    } finally { client.close(); }
  }));
  return { devices: results.flatMap((result) => result.status === 'fulfilled' ? result.value : []), warnings: results.flatMap((result, index) => result.status === 'rejected' ? [`${endpoints[index]}: ${result.reason.message}`] : []) };
}

async function withDevice(id, hosts, callback, signal) {
  signal?.throwIfAborted();
  const device = decodeDevice(id, validateHosts(hosts));
  const { host, port } = parseHost(device.endpoint);
  const client = await SaneClient.connect(host, port, signal);
  try { await client.open(device.name); return await callback(client); }
  finally { if (!signal?.aborted) { try { await client.closeDevice(); } catch {} } client.close(); }
}

function numberValue(value, type) { return type === 2 ? (value | 0) / 65536 : value | 0; }

function convertOption(option, current) {
  const values = (option.values || []).map((value) => option.type === 3 ? value : String(numberValue(value, option.type)));
  const range = option.range ? { min: numberValue(option.range.min, option.type), max: numberValue(option.range.max, option.type), step: numberValue(option.range.step, option.type) || (option.type === 2 ? 0.01 : 1) } : null;
  return { current: Array.isArray(current) ? current : option.type === 0 ? Boolean(current) : String(current ?? ''), values, range, unit: option.unit, type: option.type, count: option.type === 1 || option.type === 2 ? option.size / 4 : 1, active: !(option.cap & 32), settable: Boolean(option.cap & 1), title: option.title, description: option.description };
}

async function applyOption(client, options, name, value) {
  const option = options.find((item) => item?.name === name);
  if (!option) { if (value !== undefined && value !== '') throw new Error(`Scanner does not support ${name}.`); return { options }; }
  if (value === undefined || value === '') return { options };
  const result = await client.control(option, validateOption(option, value));
  return { options: result.info & 2 ? await client.options() : options, value: result.value };
}

async function capabilities(id, hosts, settings = {}) {
  return withDevice(id, hosts, async (client) => {
    let options = await client.options();
    for (const name of ['source', 'mode']) {
      if (settings[name] !== undefined && settings[name] !== '') ({ options } = await applyOption(client, options, name, settings[name]));
    }
    if (settings.customGamma !== undefined) ({ options } = await applyOption(client, options, 'custom-gamma', settings.customGamma));
    const result = { advanced: {} };
    const names = ['source', 'mode', 'resolution', 'tl-x', 'tl-y', 'br-x', 'br-y'];
    for (const name of names) {
      const option = options.find((item) => item?.name === name && !(item.cap & 32) && (item.cap & 1) && (item.cap & 4));
      if (option && [1, 2, 3].includes(option.type)) result[name] = convertOption(option, (await client.control(option)).value);
    }
    for (const name of ADVANCED_OPTIONS) {
      const option = options.find((item) => item?.name === name && (item.cap & 1) && (item.cap & 4));
      if (!option || ![0, 1, 2, 3].includes(option.type)) continue;
      let current;
      let readable = true;
      if (!(option.cap & 32)) {
        try { current = (await client.control(option)).value; }
        catch (error) {
          if (option.size <= 4 || ![1, 4].includes(error.saneStatus)) throw error;
          readable = false;
        }
      }
      result.advanced[name] = { ...convertOption(option, current), readable };
    }
    for (const [origin, end, position, size] of [['tl-x', 'br-x', 'l', 'x'], ['tl-y', 'br-y', 't', 'y']]) {
      if (!result[origin]?.range || !result[end]?.range || result[origin].unit !== result[end].unit || ![1, 3].includes(result[origin].unit)) continue;
      const start = result[origin].range;
      const finish = result[end].range;
      result[position] = { current: result[origin].current, values: [], range: start, unit: result[origin].unit };
      result[size] = { current: String(Number(result[end].current) - Number(result[origin].current)), values: [], range: { min: finish.step, max: finish.max - start.min, step: finish.step }, unit: result[end].unit };
    }
    return result;
  });
}

function validateOption(option, value) {
  if (!(option.cap & 1) || (option.cap & 32)) throw new Error(`Scanner setting ${option.name} is unavailable.`);
  const parsed = convertOption(option, '');
  if (option.type === 3) {
    if (typeof value !== 'string' || (parsed.values.length ? !parsed.values.includes(value) : Buffer.byteLength(value) + 1 > option.size)) throw new Error(`Unsupported ${option.name}.`);
  } else if (option.type === 0) {
    if (value !== true && value !== false && value !== 0 && value !== 1) throw new Error(`Invalid ${option.name}.`);
    value = Number(value);
  } else {
    if (![1, 2].includes(option.type)) throw new Error(`Unsupported ${option.name}.`);
    const count = option.size / 4;
    const input = Array.isArray(value) ? value : [value];
    if (input.length !== count || input.some((item) => typeof item !== 'number' && (typeof item !== 'string' || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(item)))) throw new Error(`Invalid ${option.name}: expected ${count} numeric values.`);
    const step = option.range ? numberValue(option.range.step, option.type) : 0;
    const values = input.map(Number);
    if (values.some((item) => !Number.isFinite(item) || (option.type === 1 && (!Number.isInteger(item) || item < -2147483648 || item > 2147483647)) || (option.type === 2 && (item < -32768 || item > 32767.99998474121)) || (parsed.range && (item < parsed.range.min || item > parsed.range.max)) || (step > 0 && Math.abs((item - parsed.range.min) / step - Math.round((item - parsed.range.min) / step)) > 0.0001) || (parsed.values.length && !parsed.values.includes(String(item))))) throw new Error(`Invalid ${option.name}.`);
    value = count === 1 ? values[0] : values;
  }
  return value;
}

async function scan(id, hosts, settings, area, preview = false, onProgress, signal) {
  if (!settings || typeof settings !== 'object') throw new Error('Invalid scan settings.');
  return withDevice(id, hosts, async (client) => {
    let options = await client.options();
    let dpi = 300;
    let rulerDpi = null;
    async function set(name, value) {
      const option = options.find((item) => item?.name === name);
      const result = await applyOption(client, options, name, value);
      options = result.options;
      if (name === 'resolution' && result.value !== undefined) {
        dpi = Number(result.value);
        if (option?.unit === 4 && Number.isFinite(dpi) && dpi > 0) rulerDpi = dpi;
      }
    }
    await set('source', settings.source);
    await set('mode', settings.mode);
    const resolution = options.find((item) => item?.name === 'resolution');
    let selectedResolution = settings.resolution;
    if (preview && resolution) {
      const parsed = convertOption(resolution, '');
      const choices = parsed.values.map(Number).filter(Number.isFinite);
      if (choices.length) selectedResolution = choices.reduce((best, item) => Math.abs(item - 75) < Math.abs(best - 75) ? item : best);
      else if (parsed.range) selectedResolution = Math.max(parsed.range.min, Math.min(parsed.range.max, parsed.range.min + Math.round((75 - parsed.range.min) / parsed.range.step) * parsed.range.step));
    }
    await set('resolution', selectedResolution);
    if (settings.advanced !== undefined && (!settings.advanced || typeof settings.advanced !== 'object' || Array.isArray(settings.advanced) || Object.keys(settings.advanced).some((name) => !ADVANCED_OPTIONS.includes(name)))) throw new Error('Invalid advanced scanner settings.');
    for (const name of ADVANCED_OPTIONS) await set(name, settings.advanced?.[name]);
    if (resolution && (!selectedResolution || !Number.isFinite(dpi) || dpi <= 0)) {
      const current = Number((await client.control(resolution)).value);
      if (resolution.unit === 4 && Number.isFinite(current) && current > 0) rulerDpi = current;
      dpi = current || 300;
    }
    if (area) {
      const { l, t, x, y } = area;
      if (![l, t, x, y].every((value) => Number.isFinite(value)) || x <= 0 || y <= 0) throw new Error('Invalid scan area.');
      await set('tl-x', l); await set('tl-y', t); await set('br-x', l + x); await set('br-y', t + y);
    }
    const frames = [];
    let totalBytes = 0;
    do {
      signal?.throwIfAborted();
      if (frames.length >= 3) throw new Error('Unsupported number of scan frames.');
      const data = await client.start();
      try {
        const params = await client.parameters();
        const total = params.lines > 0 && params.bytesPerLine > 0 ? params.lines * params.bytesPerLine : null;
        const frame = frames.length + 1;
        const multiFrame = !params.last || frame > 1;
        onProgress?.({ received: 0, total, frame, multiFrame });
        const pixels = await client.readFrame(data, (received) => onProgress?.({ received, total, frame, multiFrame }));
        totalBytes += pixels.length;
        if (totalBytes > 250 * 1024 * 1024) throw new Error('Scan exceeded the 250 MB limit.');
        frames.push({ params, data: pixels, byteOrder: data.byteOrder });
      } catch (error) { data.wire.socket.destroy(); throw error; }
    } while (!frames[frames.length - 1].params.last);
    await client.cancel();
    signal?.throwIfAborted();
    return { image: encodeFrames(frames), dpi, rulerDpi };
  }, signal);
}

function run(program, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { windowsHide: true });
    const output = []; const errors = []; let size = 0;
    child.stdout.on('data', (chunk) => { size += chunk.length; if (size > 250 * 1024 * 1024) child.kill(); else output.push(chunk); });
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', (error) => reject(new Error(`Could not start ${program}: ${error.message}`)));
    child.on('close', (code) => {
      if (size > 250 * 1024 * 1024) return reject(new Error('OCR output exceeded the 250 MB limit.'));
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString().trim() || `${program} exited with code ${code}`));
      resolve(Buffer.concat(output));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function languages() {
  return (await run('tesseract', ['--list-langs'])).toString().split(/\r?\n/).slice(1).map((line) => line.trim()).filter((line) => /^[\w-]+$/.test(line));
}

async function ocr(image, language, dpi) {
  if (!/^[\w-]+(?:\+[\w-]+)*$/.test(language)) throw new Error('Invalid OCR language.');
  if (!Number.isFinite(dpi) || dpi < 1 || dpi > 9600) throw new Error('Invalid scan resolution.');
  return run('tesseract', ['stdin', 'stdout', '-l', language, '--dpi', String(dpi), 'pdf'], image);
}

module.exports = { listDevices, capabilities, discoverHosts, scan, languages, ocr, parseHost, validateHosts };
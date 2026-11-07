'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { PNG } = require('pngjs');
const { PDFDocument } = require('pdf-lib');
const backend = require('../src/backend');
const { SaneClient } = require('../src/sane-net');
const { editImage } = require('../src/page-image');
const { exportPageData } = require('../src/export');

test('network SANE test backend produces a scan and searchable PDF', { skip: !process.env.SANEWIN_INTEGRATION }, async () => {
  const children = new Set();
  const server = net.createServer((socket) => {
    const config = `${path.join(__dirname, 'fixtures/sane')}:/etc/sane.d`;
    const child = spawn('saned', [], { env: { ...process.env, SANE_CONFIG_DIR: config }, stdio: [socket, socket, 'ignore'] });
    children.add(child);
    child.on('exit', () => children.delete(child));
    socket.destroy();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const hosts = [`127.0.0.1:${server.address().port}`];
    const { devices, warnings } = await backend.listDevices(hosts);
    assert.deepEqual(warnings, []);
    const device = devices.find((item) => item.device === 'test:0');
    assert.ok(device);
    const capabilities = await backend.capabilities(device.id, hosts);
    assert.ok(capabilities.mode.values.includes('Color'));
    const gamma = capabilities.advanced['gamma-table'];
    assert.ok(gamma.active && Array.isArray(gamma.current));
    const settings = { mode: 'Color', resolution: 150, source: 'Flatbed' };
    const area = { l: 10, t: 15, x: 20, y: 30 };
    const originalOptions = SaneClient.prototype.options;
    SaneClient.prototype.options = async function () {
      const options = await originalOptions.call(this);
      const source = options.find((option) => option?.name === 'source');
      if (source) source.size = Buffer.byteLength('Flatbed');
      return options;
    };
    let result;
    try {
      const progress = [];
      const preview = await backend.scan(device.id, hosts, settings, area, true, (event) => progress.push(event));
      assert.equal(preview.dpi, 75);
      assert.equal(preview.rulerDpi, 75);
      assert.equal(progress[0].received, 0);
      assert.equal(progress.at(-1).received, progress.at(-1).total);
      await assert.rejects(backend.scan(device.id, hosts, { ...settings, advanced: { 'gamma-table': [999] } }, area), /Invalid gamma-table/);
      await assert.rejects(backend.scan(device.id, hosts, { ...settings, advanced: { 'gamma-table': Array(gamma.count).fill(null) } }, area), /Invalid gamma-table/);
      const controller = new AbortController();
      await assert.rejects(backend.scan(device.id, hosts, settings, area, false, (event) => { if (event.received > 0) controller.abort(); }, controller.signal), { name: 'AbortError' });
      result = await backend.scan(device.id, hosts, { ...settings, advanced: { 'gamma-table': gamma.current } }, area);
    } finally { SaneClient.prototype.options = originalOptions; }
    const { image, dpi } = result;
    assert.equal(result.rulerDpi, 150);
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(dpi, 150);
    const decoded = PNG.sync.read(image);
    assert.ok(Math.abs(decoded.width - 20 * dpi / 25.4) <= 1);
    assert.ok(Math.abs(decoded.height - 30 * dpi / 25.4) <= 1);
    const pdf = await backend.ocr(image, 'eng', dpi);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const document = await PDFDocument.load(pdf);
    const page = document.getPage(0);
    assert.ok(Math.abs(page.getWidth() - decoded.width * 72 / dpi) < 1);
    assert.ok(Math.abs(page.getHeight() - decoded.height * 72 / dpi) < 1);
    const crop = await editImage(image, 'crop', { left: 0, top: 0, width: 0.5, height: 0.5 });
    const rotated = await editImage(crop.image, 'rotate-right');
    const edited = PNG.sync.read(rotated.image);
    assert.equal(edited.width, Math.ceil(decoded.height * 0.5));
    assert.equal(edited.height, Math.ceil(decoded.width * 0.5));
    const singlePdf = await PDFDocument.load(await exportPageData({ image: rotated.image, dpi, rulerDpi: dpi }, 'pdf', { ocr: false }));
    assert.equal(singlePdf.getPageCount(), 1);
    assert.ok(Math.abs(singlePdf.getPage(0).getWidth() - edited.width * 72 / dpi) < 0.001);
    assert.ok(Math.abs(singlePdf.getPage(0).getHeight() - edited.height * 72 / dpi) < 0.001);
  } finally { server.close(); for (const child of children) child.kill(); }
});
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultPdfName, offerOpenPdf, pageExportFormat, exportPageData } = require('../src/export');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

test('creates a timestamped PDF name', () => {
  assert.equal(defaultPdfName(new Date(2026, 10, 7, 9, 4, 3)), 'SaneWin-2026-11-07_09-04-03.pdf');
});

test('only opens a saved PDF after confirmation', async () => {
  const opened = [];
  const shell = { openPath: async (file) => { opened.push(file); return ''; } };
  await offerOpenPdf({ showMessageBox: async () => ({ response: 1 }) }, shell, null, '/tmp/example.pdf');
  assert.deepEqual(opened, []);
  await offerOpenPdf({ showMessageBox: async () => ({ response: 0 }) }, shell, null, '/tmp/example.pdf');
  assert.deepEqual(opened, ['/tmp/example.pdf']);
  await assert.rejects(offerOpenPdf({ showMessageBox: async () => ({ response: 0 }) }, { openPath: async () => 'No viewer' }, null, '/tmp/example.pdf'), /PDF saved.*No viewer/);
});

test('localizes the native PDF confirmation dialog', async () => {
  const { translate } = require('../src/i18n');
  let options;
  await offerOpenPdf({ showMessageBox: async (_window, settings) => { options = settings; return { response: 1 }; } }, {}, null, '/tmp/example.pdf', (text) => translate('fr', text));
  assert.equal(options.title, 'PDF exporté');
  assert.deepEqual(options.buttons, ['Ouvrir le PDF', 'Pas maintenant']);
});

test('exports a single edited page using its filename extension and scan DPI', async () => {
  const image = await sharp({ create: { width: 300, height: 150, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const page = { image, dpi: 300, rulerDpi: 300 };
  for (const [file, format] of [['page.PNG', 'png'], ['page.jpg', 'jpeg'], ['page.JPEG', 'jpeg'], ['page.pdf', 'pdf']]) assert.equal(pageExportFormat(file), format);
  assert.throws(() => pageExportFormat('page.gif'), /PNG, JPG/);
  assert.throws(() => pageExportFormat('page'), /PNG, JPG/);
  const png = await exportPageData(page, 'png', { ocr: false });
  const jpeg = await exportPageData(page, 'jpeg', { ocr: false });
  assert.equal((await sharp(png).metadata()).density, 300);
  assert.equal((await sharp(jpeg).metadata()).density, 300);
  assert.equal(jpeg.subarray(0, 2).toString('hex'), 'ffd8');
  const pdf = await PDFDocument.load(await exportPageData(page, 'pdf', { ocr: false }));
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getPage(0).getWidth(), 72);
  assert.equal(pdf.getPage(0).getHeight(), 36);
  const noDpi = await exportPageData({ image, dpi: 300, rulerDpi: null }, 'png', { ocr: false });
  assert.equal((await sharp(noDpi).metadata()).density, undefined);
});

test('single-page PDF uses the selected OCR settings', async () => {
  const recognized = await PDFDocument.create(); recognized.addPage([50, 60]);
  let received;
  const result = await exportPageData({ image: Buffer.from('scan'), dpi: 150 }, 'pdf', { ocr: true, language: 'deu' }, async (...args) => { received = args; return recognized.save(); });
  assert.equal(received[1], 'deu');
  assert.equal(received[2], 150);
  assert.equal((await PDFDocument.load(result)).getPageCount(), 1);
});
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

async function mainHarness(backend, clipboard = {}) {
  const handlers = new Map();
  const dialog = { showSaveDialog: async () => ({ canceled: true }) };
  const app = { whenReady: () => Promise.resolve(), getSystemLocale: () => 'en-US', getPath: () => os.tmpdir(), on() {}, quit() {} };
  class BrowserWindow {
    constructor() { this.webContents = { send() {} }; }
    setMenuBarVisibility() {}
    async loadFile() {}
    isDestroyed() { return false; }
  }
  const electron = { app, BrowserWindow, clipboard, dialog, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, nativeTheme: { shouldUseDarkColors: false }, shell: {} };
  const filename = path.join(__dirname, '../src/main.js');
  const localRequire = createRequire(filename);
  const context = vm.createContext({ require: (name) => name === 'electron' ? electron : name === './backend' ? backend : localRequire(name), __dirname: path.dirname(filename), Buffer, AbortController, process, console });
  vm.runInContext(await fs.readFile(filename, 'utf8'), context, { filename });
  await new Promise((resolve) => setImmediate(resolve));
  return { handlers, dialog, run: (code) => vm.runInContext(code, context) };
}

test('clipboard pages preserve available DPI and fall back when it is unknown', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sanewin-clipboard-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const image = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#ffffff' } }).png().withMetadata({ density: 200 }).toBuffer();
  let contents = image;
  let copied;
  let format = 'image/png';
  const clipboard = {
    availableFormats: () => contents ? [format] : [],
    readBuffer: (requestedFormat) => requestedFormat === format ? contents : Buffer.alloc(0),
    writeBuffer: (writtenFormat, image) => { format = writtenFormat; contents = Buffer.from(image); copied = Buffer.from(image); },
  };
  const { handlers, dialog, run } = await mainHarness({}, clipboard);
  const pasted = await handlers.get('pages:paste')();
  assert.equal(pasted.dpi, 200);
  assert.equal(run('pages[0].dpi'), 200);
  const filePath = path.join(directory, 'pasted.pdf');
  dialog.showSaveDialog = async () => ({ filePath, canceled: false });
  await handlers.get('page:export')(null, { id: pasted.id, ocr: false, language: '' });
  const pdf = await PDFDocument.load(await fs.readFile(filePath));
  assert.equal(pdf.getPage(0).getWidth(), 36);
  assert.equal(pdf.getPage(0).getHeight(), 18);
  await handlers.get('page:copy')(null, pasted.id);
  assert.equal((await sharp(copied).metadata()).density, 200);
  await assert.rejects(async () => handlers.get('page:copy')(null, -1), /unavailable/);
  contents = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const unknown = await handlers.get('pages:paste')();
  assert.equal(unknown.dpi, null);
  assert.equal(run('pages[1].dpi'), 300);
  contents = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#ffffff' } }).jpeg().withMetadata({ density: 150 }).toBuffer();
  format = 'image/jpeg';
  const jpeg = await handlers.get('pages:paste')();
  assert.equal(jpeg.dpi, 150);
  assert.equal((await sharp(Buffer.from(jpeg.image.split(',')[1], 'base64')).metadata()).format, 'png');
  contents = null;
  await assert.rejects(handlers.get('pages:paste')(), /does not contain an image/);
  assert.equal(run('pages.length'), 3);
});

test('canceling a feeder scan retains completed pages in main and renderer results', async () => {
  const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
  let started;
  const secondPageStarted = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  const backend = { scan: async (_device, _hosts, _options, _area, _preview, _progress, signal) => {
    calls++;
    if (calls === 1) return { image, dpi: 300, rulerDpi: 300 };
    started();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } };
  const { handlers, run } = await mainHarness(backend);
  const scanning = handlers.get('scan')(null, { device: 'test', hosts: [], options: {}, area: null, feeder: true });
  await secondPageStarted;
  await handlers.get('scan:cancel')();
  const result = await scanning;
  assert.equal(result.canceled, true);
  assert.equal(result.pages.length, 1);
  assert.equal(run('pages.length'), 1);
  assert.equal(run('pages[0].id'), result.pages[0].id);
});

test('page edits and extension-based exports operate on the selected page', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sanewin-page-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const image = await sharp({ create: { width: 300, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const backend = { scan: async () => ({ image, dpi: 300, rulerDpi: 300 }) };
  const { handlers, dialog, run } = await mainHarness(backend);
  const scanned = await handlers.get('scan')(null, { device: 'test', hosts: [], options: {}, area: null, feeder: false });
  const id = scanned.pages[0].id;
  const rotate = await handlers.get('page:edit')(null, { id, action: 'rotate-right' });
  assert.equal(rotate.page.canUndo, true);
  const cropped = await handlers.get('page:edit')(null, { id, action: 'crop', crop: { left: 0, top: 0, width: 0.5, height: 1 } });
  const cropInfo = await sharp(Buffer.from(cropped.page.image.split(',')[1], 'base64')).metadata();
  assert.deepEqual([cropInfo.width, cropInfo.height], [50, 300]);
  await assert.rejects(handlers.get('page:edit')(null, { id, action: 'crop', crop: { left: 0, top: 0, width: 5, height: 1 } }), /Invalid crop area/);
  const unchanged = await sharp(run('pages[0].image')).metadata();
  assert.deepEqual([unchanged.width, unchanged.height], [50, 300]);
  for (const extension of ['png', 'jpg', 'pdf']) {
    const filePath = path.join(directory, `page.${extension}`);
    dialog.showSaveDialog = async () => ({ filePath, canceled: false });
    assert.equal(await handlers.get('page:export')(null, { id, ocr: false, language: '' }), true);
    const output = await fs.readFile(filePath);
    if (extension === 'pdf') {
      const pdf = await PDFDocument.load(output);
      assert.equal(pdf.getPageCount(), 1);
      assert.equal(pdf.getPage(0).getWidth(), 12);
      assert.equal(pdf.getPage(0).getHeight(), 72);
    } else assert.equal((await sharp(output).metadata()).format, extension === 'jpg' ? 'jpeg' : 'png');
  }
  dialog.showSaveDialog = async () => ({ filePath: path.join(directory, 'page.gif'), canceled: false });
  await assert.rejects(handlers.get('page:export')(null, { id, ocr: false, language: '' }), /Choose a PNG/);
  const undo = await handlers.get('page:edit')(null, { id, action: 'undo' });
  const undoInfo = await sharp(Buffer.from(undo.page.image.split(',')[1], 'base64')).metadata();
  assert.deepEqual([undoInfo.width, undoInfo.height], [100, 300]);
  assert.equal(undo.page.canUndo, false);
});
'use strict';

const { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const backend = require('./backend');
const { SettingsStore, validatePreferences } = require('./settings');
const { defaultPdfName, offerOpenPdf, pageExportFormat, exportPageData } = require('./export');
const { resolveLocale, translate } = require('./i18n');
const { editImage } = require('./page-image');

let window;
let pages = [];
let nextPageId = 1;
let settingsStore;
let locale = 'en';
let activeScan = null;
const editingPages = new Set();
const t = (key, values) => translate(locale, key, values);

async function scanJob(task) {
  if (activeScan) throw new Error('A scan is already in progress.');
  const controller = new AbortController(); activeScan = controller;
  try { return await task(controller.signal); }
  finally { activeScan = null; }
}

function sendProgress(message) {
  if (window && !window.isDestroyed()) window.webContents.send('progress', message);
}

function scanProgress(label) {
  let lastFrame;
  let lastPercent;
  return ({ received, total, frame, multiFrame }) => {
    const percent = total > 0 ? Math.min(100, Math.floor(received * 100 / total)) : null;
    if (frame === lastFrame && percent === lastPercent) return;
    lastFrame = frame;
    lastPercent = percent;
    sendProgress({ message: multiFrame ? t('{label} (frame {number})', { label, number: frame }) : label, percent });
  };
}

async function readHosts() {
  try {
    return backend.validateHosts((await settingsStore.read()).hosts || []);
  } catch { return []; }
}

function pageView(page) {
  return { id: page.id, image: `data:image/png;base64,${page.image.toString('base64')}`, dpi: page.rulerDpi, canUndo: Boolean(page.previousImage) };
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 850, minHeight: 650,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f6', title: 'SaneWin NG',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.setMenuBarVisibility(false);
  await window.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  locale = resolveLocale(app.getSystemLocale());
  settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  ipcMain.handle('locale:get', () => locale);
  ipcMain.handle('hosts:get', readHosts);
  ipcMain.handle('hosts:set', (_event, hosts) => settingsStore.setHosts(hosts));
  ipcMain.handle('settings:get', async () => {
    try { return validatePreferences((await settingsStore.read()).preferences || {}); } catch { return validatePreferences({}); }
  });
  ipcMain.handle('settings:set', (_event, preferences) => settingsStore.setPreferences(preferences));
  ipcMain.handle('hosts:discover', () => backend.discoverHosts());
  ipcMain.handle('devices:list', (_event, hosts) => backend.listDevices(hosts));
  ipcMain.handle('devices:capabilities', (_event, device, hosts, settings) => backend.capabilities(device, hosts, settings));
  ipcMain.handle('scan:cancel', () => { if (activeScan) activeScan.abort(); });
  ipcMain.handle('preview', async (_event, request) => scanJob(async (signal) => {
    try {
      const { image, rulerDpi } = await backend.scan(request.device, request.hosts, request.options, request.area, true, scanProgress(t('Creating preview...')), signal);
      return { image: `data:image/png;base64,${image.toString('base64')}`, dpi: rulerDpi };
    } catch (error) { if (signal.aborted) return { canceled: true }; throw error; }
  }));
  ipcMain.handle('scan', async (_event, request) => scanJob(async (signal) => {
    const added = [];
    const limit = request.feeder ? 100 : 1;
    for (let index = 0; index < limit; index++) {
      const label = request.feeder ? t('Scanning page {number}...', { number: index + 1 }) : t('Scanning...');
      sendProgress({ message: label, percent: null });
      try {
        signal.throwIfAborted();
        const { image, dpi, rulerDpi } = await backend.scan(request.device, request.hosts, request.options, request.area, false, scanProgress(label), signal);
        const page = { id: nextPageId++, image, dpi, rulerDpi };
        pages.push(page);
        added.push(pageView(page));
      } catch (error) {
        if (signal.aborted) return { pages: added, canceled: true };
        if (request.feeder && added.length && /out of documents|no documents|document feeder empty|feeder.*empty/i.test(error.message)) break;
        if (added.length) return { pages: added, warning: error.message };
        throw error;
      }
    }
    return { pages: added, warning: request.feeder && added.length === limit ? 'Stopped after 100 pages. Scan again to continue.' : '' };
  }));
  ipcMain.handle('pages:remove', (_event, id) => { pages = pages.filter((page) => page.id !== id); });
  ipcMain.handle('pages:reorder', (_event, ids) => {
    if (!Array.isArray(ids) || ids.length !== pages.length || new Set(ids).size !== pages.length || ids.some((id) => !pages.some((page) => page.id === id))) throw new Error('Invalid page order.');
    pages = ids.map((id) => pages.find((page) => page.id === id));
  });
  ipcMain.handle('page:edit', async (_event, request) => {
    if (!request || !Number.isSafeInteger(request.id) || !['rotate-left', 'rotate-right', 'crop', 'deskew', 'undo'].includes(request.action)) throw new Error('Invalid page edit.');
    const page = pages.find((item) => item.id === request.id);
    if (!page || editingPages.has(page.id)) throw new Error('Page is unavailable.');
    editingPages.add(page.id);
    try {
      if (request.action === 'undo') {
        if (!page.previousImage) throw new Error('No page edit to undo.');
        page.image = page.previousImage; delete page.previousImage;
        return { page: pageView(page), changed: true };
      }
      const result = await editImage(page.image, request.action, request.crop);
      if (!pages.includes(page)) throw new Error('Page is unavailable.');
      if (result.changed) { page.previousImage = page.image; page.image = result.image; }
      return { page: pageView(page), changed: result.changed, angle: result.angle };
    } finally { editingPages.delete(page.id); }
  });
  ipcMain.handle('page:export', async (_event, request) => {
    if (!request || !Number.isSafeInteger(request.id) || typeof request.ocr !== 'boolean' || typeof request.language !== 'string' || request.language.length > 100) throw new Error('Invalid page export.');
    const page = pages.find((item) => item.id === request.id);
    if (!page || editingPages.has(page.id)) throw new Error('Page is unavailable.');
    const snapshot = { image: page.image, dpi: page.dpi, rulerDpi: page.rulerDpi };
    const result = await dialog.showSaveDialog(window, { title: t('Export page'), defaultPath: defaultPdfName().replace(/\.pdf$/, '.png'), filters: [{ name: t('PNG image'), extensions: ['png'] }, { name: t('JPEG image'), extensions: ['jpg', 'jpeg'] }, { name: t('PDF document'), extensions: ['pdf'] }] });
    if (result.canceled || !result.filePath) return false;
    const format = pageExportFormat(result.filePath);
    const data = await exportPageData(snapshot, format, request, backend.ocr);
    if (data.length > 250 * 1024 * 1024) throw new Error('Exported page exceeds the 250 MB limit.');
    await fs.writeFile(result.filePath, data);
    return true;
  });
  ipcMain.handle('ocr:languages', () => backend.languages());
  ipcMain.handle('pdf:export', async (_event, { ocr, language }) => {
    if (!pages.length) throw new Error('Scan a page before exporting.');
    const result = await dialog.showSaveDialog(window, { title: t('Export PDF'), defaultPath: defaultPdfName(), filters: [{ name: t('PDF document'), extensions: ['pdf'] }] });
    if (result.canceled || !result.filePath) return false;
    const pdf = await PDFDocument.create();
    for (const [index, page] of pages.entries()) {
      sendProgress(t(ocr ? 'Recognizing page {number} of {total}...' : 'Preparing page {number} of {total}...', { number: index + 1, total: pages.length }));
      if (ocr) {
        const recognized = await PDFDocument.load(await backend.ocr(page.image, language, page.dpi));
        const copied = await pdf.copyPages(recognized, recognized.getPageIndices());
        copied.forEach((item) => pdf.addPage(item));
      } else {
        const image = await pdf.embedPng(page.image);
        const pdfPage = pdf.addPage([image.width * 72 / page.dpi, image.height * 72 / page.dpi]);
        pdfPage.drawImage(image, { x: 0, y: 0, width: pdfPage.getWidth(), height: pdfPage.getHeight() });
      }
    }
    await fs.writeFile(result.filePath, await pdf.save());
    await offerOpenPdf(dialog, shell, window, result.filePath, t);
    return true;
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting || !settingsStore) return;
  event.preventDefault();
  settingsStore.pending.catch(() => {}).finally(() => { quitting = true; app.quit(); });
});
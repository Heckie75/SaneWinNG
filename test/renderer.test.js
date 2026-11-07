'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() {
    this.children = []; this.listeners = {}; this.attributes = {}; this.style = {}; this.dataset = {}; this.value = ''; this.hidden = false;
    const classes = new Set();
    this.classList = { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name), remove: (name) => classes.delete(name), add: (name) => classes.add(name) };
  }
  append(...children) { this.children.push(...children); }
  add(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  get options() { return this.children; }
  get firstElementChild() { return this.children[0]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelectorAll() { return []; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  dispatch(name, event = {}) { return this.listeners[name]?.({ currentTarget: this, ...event }); }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  setPointerCapture() {}
}

function renderer() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  element('paper').value = 'free';
  element('device').value = 'scanner';
  Object.assign(element('preview-image'), { complete: true, naturalWidth: 100, naturalHeight: 100 });
  const scanner = {
    onProgress() {},
    scan: async () => ({ pages: [], warning: '' }),
    preview: async () => ({ image: 'scanner-image', dpi: 75 }),
    removePage: async () => {},
    reorderPages: async () => {},
  };
  let resize;
  const ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} };
  const document = { getElementById: element, createElement: () => new Element(), addEventListener() {}, documentElement: {}, body: {} };
  const Option = class { constructor(text, value) { this.textContent = text; this.value = value; } };
  const context = vm.createContext({ document, Option, NodeFilter: { SHOW_TEXT: 4 }, window: { scanner, ResizeObserver, paperGeometry: require('../src/paper'), rulerGeometry: require('../src/ruler'), i18n: require('../src/i18n'), innerWidth: 1000, innerHeight: 800 }, confirm: () => true });
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
  vm.runInContext(source.slice(0, source.lastIndexOf("\noperation('Looking for scanners...', async () => {")), context);
  const run = (code) => vm.runInContext(code, context);
  run("state.capabilities = { advanced: {}, x: { unit: 3 } }; state.area = { l: 10, t: 20, x: 30, y: 40 };");
  return { element, scanner, document, run, resize: () => resize() };
}

test('scans without a preview, selects the last page, and switches pages', async () => {
  const { element, scanner, run } = renderer();
  let scannedArea;
  scanner.scan = async (request) => { scannedArea = request.area; return { pages: [{ id: 1, image: 'first' }, { id: 2, image: 'second' }], warning: 'Feeder stopped' }; };
  await element('scan').dispatch('click');
  assert.equal(element('preview-image').src, 'second');
  assert.equal(element('preview-image').alt, 'Scanned page 2');
  assert.equal(element('empty-preview').hidden, true);
  assert.equal(element('selection').hidden, true);
  assert.equal(element('feedback').textContent, 'Feeder stopped');
  assert.equal(scannedArea.x, 30);
  const pages = element('pages');
  assert.equal(pages.children[1].firstElementChild.attributes['aria-pressed'], 'true');
  pages.children[0].firstElementChild.dispatch('click');
  assert.equal(element('preview-image').src, 'first');
  assert.equal(pages.children[0].firstElementChild.attributes['aria-pressed'], 'true');
  assert.equal(pages.children[0].firstElementChild.focused, true);
  assert.equal(run('state.area.x'), 30);
});

test('canceling a scan keeps existing and completed feeder pages', async () => {
  const { element, scanner, run } = renderer();
  run("state.pages = [{ id: 1, image: 'existing' }]; state.selectedPageId = 1; renderPreview(); renderPages();");
  let finish;
  scanner.scan = () => new Promise((resolve) => { finish = resolve; });
  scanner.cancelScan = async () => finish({ pages: [{ id: 2, image: 'completed' }], canceled: true });
  const scanning = element('scan').dispatch('click');
  assert.equal(element('scan-progress-container').hidden, false);
  await element('cancel-scan').dispatch('click');
  await scanning;
  assert.equal(run('state.pages.length'), 2);
  assert.equal(element('preview-image').src, 'completed');
  assert.equal(element('feedback').textContent, 'Scan canceled. 1 page added.');
  assert.equal(element('scan-progress-container').hidden, true);
});

test('canceling a scanner preview preserves the previous preview and area', async () => {
  const { element, scanner, run } = renderer();
  run("state.scannerPreview = 'existing-preview'; state.previewArea = { l: 0, t: 0, x: 100, y: 100 }; renderPreview();");
  let finish;
  scanner.preview = () => new Promise((resolve) => { finish = resolve; });
  scanner.cancelScan = async () => finish({ canceled: true });
  const scanning = element('preview').dispatch('click');
  await element('cancel-scan').dispatch('click');
  await scanning;
  assert.equal(element('preview-image').src, 'existing-preview');
  assert.equal(run('state.area.x'), 30);
  assert.equal(element('feedback').textContent, 'Preview canceled.');
});

test('reordering and removing pages retain selection or choose the nearest page', async () => {
  const { element, scanner, run } = renderer();
  let order;
  scanner.reorderPages = async (ids) => { order = Array.from(ids); };
  scanner.scan = async () => ({ pages: [{ id: 1, image: 'first' }, { id: 2, image: 'second' }, { id: 3, image: 'third' }], warning: '' });
  await element('scan').dispatch('click');
  const pages = element('pages');
  await pages.children[2].children[1].children[0].dispatch('click');
  assert.deepEqual(order, [1, 3, 2]);
  assert.equal(element('preview-image').src, 'third');
  assert.equal(element('preview-image').alt, 'Scanned page 2');
  await pages.children[1].children[1].children[3].dispatch('click');
  assert.equal(element('preview-image').src, 'second');
  assert.equal(run('state.selectedPageId'), 2);
  await pages.children[1].children[1].children[3].dispatch('click');
  assert.equal(element('preview-image').src, 'first');
  await pages.children[0].children[1].children[3].dispatch('click');
  assert.equal(element('empty-preview').hidden, false);
  assert.equal(element('scan-sheet').hidden, true);
  assert.equal(run('state.selectedPageId'), null);
});

test('scanner preview and scan area remain separate from page viewing', async () => {
  const { element, scanner, run } = renderer();
  run("state.scannerPreview = 'scanner-image'; state.previewArea = { l: 0, t: 0, x: 100, y: 100 }; renderPreview();");
  assert.equal(element('selection').hidden, false);
  let scannedArea;
  scanner.scan = async (request) => { scannedArea = request.area; return { pages: [{ id: 1, image: 'page-image' }], warning: '' }; };
  await element('scan').dispatch('click');
  assert.equal(element('selection').hidden, true);
  assert.equal(element('show-scanner-preview').hidden, false);
  element('scan-sheet').dispatch('pointerdown', { clientX: 5, clientY: 5, pointerId: 1 });
  element('scan-sheet').dispatch('pointermove', { clientX: 70, clientY: 70 });
  element('scan-sheet').dispatch('pointerup', { clientX: 70, clientY: 70 });
  assert.equal(run('state.area.x'), 30);
  assert.equal(scannedArea.x, 30);
  assert.equal(element('selection').hidden, true);
  element('show-scanner-preview').dispatch('click');
  assert.equal(element('preview-image').src, 'scanner-image');
  assert.equal(element('selection').hidden, false);
  assert.equal(run('state.area.x'), 30);
  element('pages').children[0].firstElementChild.dispatch('click');
  await element('pages').children[0].children[1].children[3].dispatch('click');
  assert.equal(element('preview-image').src, 'scanner-image');
  assert.equal(element('selection').hidden, false);
  scanner.scan = async () => ({ pages: [{ id: 2, image: 'another-page' }], warning: '' });
  await element('scan').dispatch('click');
  run('resetPreview()');
  assert.equal(element('preview-image').src, 'another-page');
  assert.equal(element('show-scanner-preview').hidden, true);
});

test('crops and undoes a scanned page without changing scanner area', async () => {
  const { element, scanner, run } = renderer();
  run("state.scannerPreview = 'scanner-image'; state.previewArea = { l: 0, t: 0, x: 100, y: 100 }; state.pages = [{ id: 1, image: 'page-image', dpi: 300 }]; state.selectedPageId = 1; renderPreview(); renderPages();");
  const sheet = element('scan-sheet');
  sheet.getBoundingClientRect = () => ({ left: -250, top: -150, right: 950, bottom: 750, width: 1200, height: 900 });
  element('page-crop').dispatch('click');
  assert.equal(element('page-crop-apply').disabled, true);
  sheet.dispatch('pointerdown', { clientX: 50, clientY: 30, pointerId: 1 });
  sheet.dispatch('pointermove', { clientX: 230, clientY: 210 });
  sheet.dispatch('pointerup', { clientX: 230, clientY: 210 });
  assert.equal(element('page-crop-apply').disabled, false);
  assert.equal(run('state.area.x'), 30);
  let request;
  scanner.editPage = async (value) => { request = value; return { page: { id: 1, image: value.action === 'undo' ? 'page-image' : 'cropped-image', dpi: 300, canUndo: value.action !== 'undo' }, changed: true }; };
  await element('page-crop-apply').dispatch('click');
  assert.equal(request.action, 'crop');
  assert.equal(request.crop.left, 0.25);
  assert.equal(request.crop.top, 0.2);
  assert.ok(Math.abs(request.crop.width - 0.15) < 1e-10);
  assert.ok(Math.abs(request.crop.height - 0.2) < 1e-10);
  assert.equal(element('preview-image').src, 'cropped-image');
  assert.equal(element('page-undo').disabled, false);
  await element('page-undo').dispatch('click');
  assert.equal(element('preview-image').src, 'page-image');
  assert.equal(run('state.area.x'), 30);
  element('show-scanner-preview').dispatch('click');
  assert.equal(element('preview-image').src, 'scanner-image');
  assert.equal(run('state.area.x'), 30);
});

test('exports the chosen page without altering the document or main PDF action', async () => {
  const { element, scanner, run } = renderer();
  run("state.pages = [{ id: 1, image: 'first' }, { id: 2, image: 'second' }]; state.selectedPageId = 1; renderPreview(); renderPages();");
  element('ocr').checked = true; element('language').value = 'eng';
  let exported;
  scanner.exportPage = async (request) => { exported = request; return true; };
  const actions = element('pages').children[1].children[1].children;
  assert.equal(actions[2].attributes['aria-label'], 'Export page');
  assert.equal(actions[3].attributes['aria-label'], 'Remove page');
  await actions[2].dispatch('click');
  assert.equal(exported.id, 2);
  assert.equal(exported.ocr, true);
  assert.equal(exported.language, 'eng');
  assert.equal(element('feedback').textContent, 'Page exported.');
  assert.equal(run('state.pages.length'), 2);
  assert.equal(run('state.selectedPageId'), 1);
});

test('zoom controls fit, resize, use actual pixels, and anchor mouse zoom', () => {
  const { element, run, resize } = renderer();
  const image = element('preview-image'); const sheet = element('scan-sheet'); const stage = element('preview-stage');
  Object.assign(image, { naturalWidth: 1200, naturalHeight: 900, complete: true });
  Object.assign(stage, { clientWidth: 400, clientHeight: 300, scrollLeft: 0, scrollTop: 0 });
  stage.getBoundingClientRect = () => ({ left: 10, top: 20, width: stage.clientWidth, height: stage.clientHeight });
  sheet.getBoundingClientRect = () => {
    const width = Number.parseFloat(sheet.style.width) || 0; const height = width * 0.75;
    return { left: 10 + Math.max(0, (stage.clientWidth - width) / 2) - stage.scrollLeft, top: 20 + Math.max(0, (stage.clientHeight - height) / 2) - stage.scrollTop, width, height };
  };
  run("state.scannerPreview = 'scanner-image'; state.previewArea = { l: 0, t: 0, x: 200, y: 200 }; renderPreview();");
  assert.equal(element('zoom-in').disabled, true);
  image.dispatch('load');
  assert.equal(sheet.style.width, '400px');
  assert.equal(element('zoom-value').textContent, '33%');
  stage.clientWidth = 600; stage.clientHeight = 450; resize();
  assert.equal(sheet.style.width, '600px');
  assert.equal(element('zoom-value').textContent, '50%');
  element('zoom-actual').dispatch('click');
  assert.equal(sheet.style.width, '1200px');
  assert.equal(element('zoom-value').textContent, '100%');
  stage.scrollLeft = 250; stage.scrollTop = 150;
  const anchor = { x: 310, y: 220 }; const before = sheet.getBoundingClientRect();
  let prevented = false;
  stage.dispatch('wheel', { ctrlKey: true, deltaY: -100, clientX: anchor.x, clientY: anchor.y, preventDefault: () => { prevented = true; } });
  const after = sheet.getBoundingClientRect();
  assert.equal(prevented, true);
  assert.ok(Math.abs((anchor.x - before.left) / before.width - (anchor.x - after.left) / after.width) < 1e-10);
  assert.ok(Math.abs((anchor.y - before.top) / before.height - (anchor.y - after.top) / after.height) < 1e-10);
  assert.equal(element('zoom-value').textContent, '125%');
  stage.dispatch('wheel', { ctrlKey: false, deltaY: 100, preventDefault: () => assert.fail('ordinary scrolling must not be prevented') });
  element('zoom-out').dispatch('click');
  assert.equal(element('zoom-value').textContent, '100%');
  element('zoom-in').dispatch('click');
  assert.equal(element('zoom-value').textContent, '125%');
  resize();
  assert.equal(element('zoom-value').textContent, '125%');
  element('zoom-fit').dispatch('click');
  assert.equal(element('zoom-value').textContent, '50%');
});

test('scrolled and zoomed pointer coordinates select the same scanner area', () => {
  const { element, run } = renderer();
  run("state.scannerPreview = 'scanner-image'; state.previewArea = { l: 0, t: 0, x: 200, y: 200 }; renderPreview();");
  for (const name of ['l', 't', 'x', 'y', 'br-x', 'br-y']) run(`state.capabilities['${name}'] = { range: { min: 0, max: 200, step: 1 }, unit: 3 }`);
  const sheet = element('scan-sheet');
  sheet.getBoundingClientRect = () => ({ left: -250, top: -150, width: 1200, height: 900 });
  sheet.dispatch('pointerdown', { clientX: 50, clientY: 30, pointerId: 1 });
  sheet.dispatch('pointermove', { clientX: 230, clientY: 210 });
  sheet.dispatch('pointerup', { clientX: 230, clientY: 210 });
  assert.equal(run('state.area.l'), 50);
  assert.equal(run('state.area.t'), 40);
  assert.equal(run('state.area.x'), 30);
  assert.equal(run('state.area.y'), 40);
  assert.equal(element('selection').style.left, '25%');
  assert.equal(element('selection').style.top, '20%');
  element('paper').value = 'a6-portrait';
  run('state.area = { l: 10, t: 20, x: 105, y: 148 }; paintArea();');
  sheet.dispatch('pointerdown', { clientX: -130, clientY: -15, pointerId: 2 });
  sheet.dispatch('pointermove', { clientX: -10, clientY: 75 });
  sheet.dispatch('pointerup', { clientX: -10, clientY: 75 });
  assert.equal(run('state.area.l'), 30);
  assert.equal(run('state.area.t'), 40);
  assert.equal(run('state.area.x'), 105);
  assert.equal(run('state.area.y'), 148);
});

test('rulers track selection and pointer, switch units, and use each image DPI', async () => {
  const { element, scanner, run } = renderer();
  const image = element('preview-image'); const stage = element('preview-stage'); const sheet = element('scan-sheet');
  Object.assign(image, { naturalWidth: 1200, naturalHeight: 900, complete: true });
  Object.assign(stage, { clientWidth: 400, clientHeight: 300, scrollLeft: 0, scrollTop: 0 });
  stage.getBoundingClientRect = () => ({ left: 10, top: 20, right: 410, bottom: 320, width: 400, height: 300 });
  sheet.getBoundingClientRect = () => ({ left: -90, top: -30, right: 510, bottom: 420, width: 600, height: 450 });
  run("state.scannerPreview = 'scanner-image'; state.scannerPreviewDpi = 300; state.previewArea = { l: 0, t: 0, x: 200, y: 200 }; state.area = { l: 50, t: 40, x: 100, y: 80 }; state.zoom = 0.5; state.shownImage = 'scanner-image'; renderPreview();");
  assert.equal(element('ruler-size').textContent, 'Selection: 50.8 x 30.48 mm');
  assert.equal(element('ruler-x-selection').style.left, '50px');
  assert.equal(element('ruler-y-selection').style.top, '40px');
  sheet.dispatch('pointermove', { clientX: 100, clientY: 100 });
  assert.equal(element('ruler-x-pointer').hidden, false);
  assert.equal(element('ruler-x-pointer').style.left, '90px');
  sheet.dispatch('pointerleave');
  assert.equal(element('ruler-x-pointer').hidden, true);
  let saved;
  scanner.setSettings = async (preferences) => { saved = preferences.rulerUnit; };
  run('state.ready = true');
  element('ruler-in').dispatch('click');
  assert.equal(saved, 'in');
  assert.equal(element('ruler-size').textContent, 'Selection: 2 x 1.2 in');
  scanner.scan = async () => ({ pages: [{ id: 1, image: 'known-page', dpi: 150 }, { id: 2, image: 'unknown-page', dpi: null }], warning: '' });
  await element('scan').dispatch('click');
  run('state.zoom = 0.5; renderRulers();');
  assert.equal(element('ruler-status').hidden, false);
  assert.equal(element('ruler-x-ticks').children.length, 0);
  assert.equal(element('ruler-size').hidden, true);
  element('pages').children[0].firstElementChild.dispatch('click');
  run('state.zoom = 0.5; renderRulers();');
  assert.equal(run('currentRulerDpi()'), 150);
  assert.equal(element('ruler-status').hidden, true);
  assert.ok(element('ruler-x-ticks').children.length > 0);
  element('pages').children[1].firstElementChild.dispatch('click');
  run('state.zoom = 0.5; renderRulers();');
  element('ruler-px').dispatch('click');
  assert.equal(saved, 'px');
  assert.equal(element('ruler-status').hidden, true);
  assert.ok(element('ruler-x-ticks').children.length > 0);
  element('show-scanner-preview').dispatch('click');
  assert.equal(element('ruler-size').textContent, 'Selection: 600 x 360 px');
});

test('localizes dynamic page labels, status, and scanner errors', async () => {
  for (const [locale, pageLabel, status, error] of [
    ['de', 'Seite 1', '1 Seite hinzugefügt.', 'Ungültiger Scanbereich.'],
    ['fr', 'Page 1', '1 page ajoutée.', 'Zone de numérisation non valide.'],
    ['es', 'Página 1', '1 página añadida.', 'Área de escaneo no válida.'],
  ]) {
    const { element, scanner, run } = renderer();
    run(`state.locale = '${locale}'`);
    scanner.scan = async () => ({ pages: [{ id: 1, image: 'page', dpi: 300 }], warning: '' });
    await element('scan').dispatch('click');
    assert.equal(element('pages').children[0].firstElementChild.children[1].textContent, pageLabel);
    assert.equal(element('feedback').textContent, status);
    scanner.scan = async () => { throw new Error('Invalid scan area.'); };
    await element('scan').dispatch('click');
    assert.equal(element('feedback').textContent, error);
  }
});

test('localizes static text, accessibility labels, and scanner option display without changing values', () => {
  const { element, document, run } = renderer();
  const nodes = [{ nodeValue: ' Preview ' }, { nodeValue: 'Source' }];
  document.createTreeWalker = () => ({ currentNode: null, index: 0, nextNode() { this.currentNode = nodes[this.index++]; return Boolean(this.currentNode); } });
  const control = new Element(); control.setAttribute('title', 'Zoom in'); control.setAttribute('aria-label', 'Zoom in');
  document.querySelectorAll = () => [control];
  element('paper').children = [{ value: 'a4-portrait' }, { value: 'letter-landscape' }];
  run("state.locale = 'de'; localizeDocument(); setOptions('source', ['Flatbed', 'Feeder'], 'Flatbed');");
  assert.equal(document.documentElement.lang, 'de');
  assert.equal(nodes[0].nodeValue, ' Vorschau ');
  assert.equal(nodes[1].nodeValue, 'Quelle');
  assert.equal(control.getAttribute('aria-label'), 'Vergrößern');
  assert.equal(control.getAttribute('title'), 'Vergrößern');
  assert.equal(element('paper').options[0].textContent, 'A4 Hochformat');
  assert.equal(element('paper').options[1].textContent, 'Letter Querformat');
  assert.equal(element('source').options[0].textContent, 'Flachbett');
  assert.equal(element('source').options[0].value, 'Flatbed');
});
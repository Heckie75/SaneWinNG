'use strict';

const element = (id) => document.getElementById(id);
const state = { locale: 'en', hosts: [], devices: [], capabilities: {}, pages: [], selectedPageId: null, cropPageId: null, cropBox: null, scannerPreview: null, scannerPreviewDpi: null, shownImage: null, zoom: null, area: null, previewArea: null, selectionBox: null, pointer: null, busy: false, ocrAvailable: false, ready: false, advanced: {}, invalid: new Set(), preferences: { selectedDevice: '', scanners: {}, ocr: false, language: '', feeder: false, rulerUnit: 'mm' } };
const controls = ['device', 'source', 'mode', 'resolution', 'preview', 'scan', 'refresh', 'network-open', 'export', 'feeder', 'ocr', 'paste-page'];
const t = (key, values) => window.i18n.translate(state.locale, key, values);
const errorText = (error) => window.i18n.translateError(state.locale, error);

function localizeDocument() {
  document.documentElement.lang = state.locale;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode; const text = node.nodeValue.trim();
    if (text) node.nodeValue = node.nodeValue.replace(text, t(text));
  }
  for (const node of document.querySelectorAll('[title], [aria-label], [alt], [placeholder]')) {
    for (const attribute of ['title', 'aria-label', 'alt', 'placeholder']) if (node.hasAttribute(attribute)) node.setAttribute(attribute, t(node.getAttribute(attribute)));
  }
  for (const option of element('paper').options) {
    const match = option.value.match(/^(.+)-(portrait|landscape)$/);
    if (match) option.textContent = t(`{paper} ${match[2]}`, { paper: /^a\d$/.test(match[1]) ? match[1].toUpperCase() : match[1][0].toUpperCase() + match[1].slice(1) });
  }
}

function message(text, error = false) {
  element('feedback').textContent = t(text);
  element('feedback').classList.toggle('error', error);
}

function updateControls() {
  const selected = Boolean(element('device').value);
  const scannerReady = selected && state.capabilities.advanced !== undefined;
  for (const id of controls) element(id).disabled = state.busy;
  for (const id of ['source', 'mode', 'resolution']) element(id).disabled = state.busy || !state.capabilities[id];
  element('paper').disabled = state.busy || !selected || !fullArea() || state.capabilities.x?.unit !== 3 || state.capabilities.y?.unit !== 3;
  for (const control of element('advanced-options').querySelectorAll('input,select,textarea,button')) control.disabled = state.busy || !scannerReady || control.dataset.unavailable === 'true';
  for (const id of ['preview', 'scan']) element(id).disabled = state.busy || !scannerReady || state.invalid.size > 0;
  element('export').disabled = state.busy || !state.pages.length;
  element('ocr').disabled = state.busy || !state.ocrAvailable;
  element('feeder').disabled = state.busy || !scannerReady || !/feeder|adf/i.test(element('source').value);
  if (element('feeder').disabled && !state.busy) element('feeder').checked = false;
  element('reset-area').disabled = state.busy || !scannerReady || !state.area;
  const page = state.pages.find((item) => item.id === state.selectedPageId);
  const cropping = Boolean(page && state.cropPageId === page.id);
  const image = element('preview-image');
  const pageReady = Boolean(page && state.shownImage && image.complete && image.naturalWidth && image.naturalHeight);
  element('page-edit-actions').hidden = !page;
  for (const id of ['page-rotate-left', 'page-rotate-right', 'page-deskew', 'page-undo']) element(id).disabled = state.busy || !pageReady || cropping || (id === 'page-undo' && !page?.canUndo);
  element('page-crop').hidden = cropping;
  element('page-crop').disabled = state.busy || !pageReady;
  for (const id of ['page-crop-apply', 'page-crop-cancel']) { element(id).hidden = !cropping; element(id).disabled = state.busy || (id === 'page-crop-apply' && !state.cropBox); }
  element('page-count').textContent = state.pages.length;
  element('page-summary').textContent = state.pages.length ? t(state.pages.length === 1 ? '{count} page ready' : '{count} pages ready', { count: state.pages.length }) : t('No pages yet');
  element('connection-status').textContent = t(scannerReady ? 'Scanner connected' : selected ? 'Scanner unavailable' : 'No scanner selected');
}

function savePreferences() {
  if (!state.ready) return;
  const id = element('device').value;
  if (id && state.capabilities.advanced !== undefined) {
    state.preferences.selectedDevice = id;
    state.preferences.scanners[id] = { source: element('source').value, mode: element('mode').value, resolution: element('resolution').value, paper: element('paper').value, area: state.area, advanced: { ...state.advanced } };
  }
  state.preferences.ocr = element('ocr').checked;
  state.preferences.language = element('language').value;
  state.preferences.feeder = element('feeder').checked;
  window.scanner.setSettings(state.preferences).catch((error) => message(t('Could not save settings: {detail}', { detail: errorText(error.message) }), true));
}

const advancedLabels = { 'custom-gamma': 'Custom gamma', 'gamma-table': 'Intensity gamma table', 'red-gamma-table': 'Red gamma table', 'green-gamma-table': 'Green gamma table', 'blue-gamma-table': 'Blue gamma table', brightness: 'Brightness', contrast: 'Contrast', 'lamp-off-time': 'Lamp off after (minutes)', 'lamp-off-scan': 'Lamp off during scan', 'color-filter': 'Color filter' };

function validAdvanced(option, value) {
  if (option.type === 0) return typeof value === 'boolean';
  if (option.type === 3) return typeof value === 'string' && (!option.values.length || option.values.includes(value));
  const values = Array.isArray(value) ? value : [value];
  if (values.length !== option.count) return false;
  return values.every((number) => typeof number === 'number' && Number.isFinite(number) && (option.type !== 1 || Number.isInteger(number)) && (!option.range || (number >= option.range.min && number <= option.range.max && Math.abs((number - option.range.min) / option.range.step - Math.round((number - option.range.min) / option.range.step)) < 0.0001)) && (!option.values.length || option.values.includes(String(number))));
}

function renderAdvanced() {
  const container = element('advanced-options');
  container.replaceChildren();
  state.invalid.clear();
  const options = state.capabilities.advanced || {};
  if (!Object.keys(options).length) {
    const note = document.createElement('span'); note.className = 'option-note'; note.textContent = t('No advanced settings available.'); container.append(note); return;
  }
  for (const [name, option] of Object.entries(options)) {
    const labelText = advancedLabels[name] ? t(advancedLabels[name]) : option.title || name;
    if (option.active && option.readable && !validAdvanced(option, state.advanced[name])) {
      const current = option.type === 0 ? option.current : option.type === 3 ? option.current : Array.isArray(option.current) ? option.current : option.current === '' ? undefined : Number(option.current);
      if (validAdvanced(option, current)) state.advanced[name] = current;
      else delete state.advanced[name];
    }
    const wrapper = document.createElement('div'); wrapper.className = 'advanced-option';
    const note = document.createElement('small'); note.className = 'option-note'; note.setAttribute('aria-live', 'polite');
    const available = option.active && option.settable;
    const prepare = (control) => { control.dataset.unavailable = available ? 'false' : 'true'; control.disabled = state.busy || !available; control.title = advancedLabels[name] ? labelText : option.description || labelText; };
    if (option.type === 0) {
      const label = document.createElement('label'); label.className = 'check-row';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = Boolean(state.advanced[name]); prepare(input);
      const title = document.createElement('strong'); title.textContent = labelText; label.append(input, title); wrapper.append(label);
      input.addEventListener('change', () => {
        state.advanced[name] = input.checked; savePreferences();
        if (name === 'custom-gamma') operation('Updating scanner settings...', async () => { await loadCapabilities(true); message('Scanner settings updated.'); });
      });
    } else if (option.count > 1) {
      const details = document.createElement('details'); details.className = 'gamma-setting';
      const summary = document.createElement('summary'); summary.textContent = labelText;
      const textarea = document.createElement('textarea'); textarea.setAttribute('aria-label', labelText); textarea.spellcheck = false; textarea.placeholder = t('{count} comma-separated values', { count: option.count }); textarea.value = Array.isArray(state.advanced[name]) ? state.advanced[name].join(', ') : ''; prepare(textarea);
      details.append(summary, textarea); wrapper.append(details);
      if (option.range && option.count > 1 && !option.values.length) {
        const linear = document.createElement('button'); linear.type = 'button'; linear.className = 'button secondary gamma-linear'; linear.textContent = t('Linear'); linear.title = t('Generate a linear {label}', { label: labelText }); linear.disabled = state.busy || !available; linear.dataset.unavailable = available ? 'false' : 'true'; details.append(linear);
        linear.addEventListener('click', () => {
          const { min, max, step } = option.range;
          const values = Array.from({ length: option.count }, (_, index) => Number(Math.min(max, min + Math.round(((max - min) * index / (option.count - 1)) / step) * step).toFixed(4)));
          textarea.value = values.join(', '); textarea.dispatchEvent(new Event('input'));
        });
      }
      const description = option.range ? t('{count} values, {min} to {max}.', { count: option.count, min: option.range.min, max: option.range.max }) : t('{count} values.', { count: option.count });
      note.textContent = !available ? t('Unavailable with current scanner settings.') : option.readable ? description : t('{description} Leave empty to retain the scanner default.', { description });
      textarea.addEventListener('input', () => {
        const text = textarea.value.trim();
        if (!text) { delete state.advanced[name]; state.invalid.delete(name); note.textContent = description; note.classList.remove('option-error'); textarea.removeAttribute('aria-invalid'); savePreferences(); updateControls(); return; }
        const parts = text.split(/[\s,]+/);
        const values = parts.map(Number);
        if (!parts.every((part) => /^-?\d+(?:\.\d+)?$/.test(part)) || !validAdvanced(option, values)) { state.invalid.add(name); note.textContent = t('Enter {description}', { description }); note.classList.add('option-error'); textarea.setAttribute('aria-invalid', 'true'); }
        else { state.advanced[name] = values; state.invalid.delete(name); note.textContent = description; note.classList.remove('option-error'); textarea.removeAttribute('aria-invalid'); savePreferences(); }
        updateControls();
      });
    } else if (option.type === 3 || (!option.range && option.values.length)) {
      const label = document.createElement('label'); label.textContent = labelText;
      const select = document.createElement('select'); select.setAttribute('aria-label', labelText); prepare(select);
      for (const value of option.values) select.add(new Option(t(value), value));
      if (validAdvanced(option, state.advanced[name])) select.value = String(state.advanced[name]);
      label.append(select); wrapper.append(label);
      select.addEventListener('change', () => { state.advanced[name] = option.type === 3 ? select.value : Number(select.value); savePreferences(); });
    } else if (option.range) {
      const label = document.createElement('label'); label.textContent = labelText;
      const row = document.createElement('div'); row.className = 'number-control';
      const slider = document.createElement('input'); slider.type = 'range'; slider.setAttribute('aria-label', t('{label} slider', { label: labelText }));
      const input = document.createElement('input'); input.type = 'number'; input.setAttribute('aria-label', labelText);
      for (const control of [slider, input]) { control.min = option.range.min; control.max = option.range.max; control.step = option.range.step; control.value = state.advanced[name] ?? option.range.min; prepare(control); }
      row.append(slider, input); label.append(row); wrapper.append(label);
      const update = (source) => {
        const value = Number(source.value);
        if (source.value === '' || !source.checkValidity() || !validAdvanced(option, value)) { state.invalid.add(name); input.setAttribute('aria-invalid', 'true'); note.textContent = t('Enter a value from {min} to {max} in steps of {step}.', option.range); note.classList.add('option-error'); }
        else { input.value = value; slider.value = value; state.advanced[name] = value; state.invalid.delete(name); input.removeAttribute('aria-invalid'); note.textContent = ''; note.classList.remove('option-error'); savePreferences(); }
        updateControls();
      };
      slider.addEventListener('input', () => update(slider)); input.addEventListener('input', () => update(input));
    } else continue;
    if (!available) note.textContent = t('Unavailable with current scanner settings.');
    wrapper.append(note); container.append(wrapper);
  }
}

function updatePaperOptions(preferred = 'free') {
  const select = element('paper');
  for (const option of select.options) option.disabled = option.value !== 'free' && !window.paperGeometry.presetArea(option.value, state.capabilities);
  const chosen = Array.from(select.options).find((option) => option.value === preferred && !option.disabled);
  select.value = chosen ? chosen.value : 'free';
}

function restoreArea(area) {
  if (element('paper').value !== 'free') return window.paperGeometry.presetArea(element('paper').value, state.capabilities, area);
  const bounds = fullArea();
  if (!bounds || !area || !['l', 't', 'x', 'y'].every((name) => Number.isFinite(area[name])) || area.x <= 0 || area.y <= 0 || area.l < bounds.l || area.t < bounds.t || area.l + area.x > bounds.l + bounds.x + 0.001 || area.t + area.y > bounds.t + bounds.y + 0.001) return null;
  return { ...area };
}

function setScanProgress(label, percent) {
  element('scan-progress-label').textContent = label;
  element('scan-progress-percent').textContent = Number.isFinite(percent) ? `${percent}%` : '';
  if (Number.isFinite(percent)) element('scan-progress').value = percent;
  else element('scan-progress').removeAttribute('value');
}

async function operation(label, task, scanning = false) {
  if (state.busy) return;
  label = t(label);
  state.busy = true;
  state.scanning = scanning;
  if (scanning) { setScanProgress(label, null); element('cancel-scan').disabled = false; element('scan-progress-container').hidden = false; }
  message(label);
  updateControls();
  try { await task(); } catch (error) { message(errorText(error.message), true); }
  finally { state.busy = false; state.scanning = false; element('scan-progress-container').hidden = true; renderPages(); updateControls(); }
}

function setOptions(id, values, selected) {
  const select = element(id);
  select.replaceChildren();
  if (!values.length) {
    select.add(new Option(t('Not available'), ''));
    return;
  }
  for (const value of values) select.add(new Option(id === 'resolution' ? `${value} dpi` : t(value), value));
  select.value = values.includes(String(selected)) ? String(selected) : values[0];
}

function resetPreview() {
  state.previewArea = null;
  state.scannerPreview = null;
  state.scannerPreviewDpi = null;
  updateAreaLabel();
  renderPreview();
}

async function loadCapabilities(preservePreview = false) {
  if (!preservePreview) resetPreview();
  state.capabilities = {};
  const device = element('device').value;
  if (!device) { state.capabilities = {}; updateControls(); return; }
  const saved = state.preferences.scanners[device] || {};
  const requested = { source: saved.source, mode: saved.mode, customGamma: saved.advanced?.['custom-gamma'] };
  let caps;
  let applied = requested;
  try { caps = await window.scanner.capabilities(device, state.hosts, applied); }
  catch {
    applied = { source: requested.source, mode: requested.mode };
    try { caps = await window.scanner.capabilities(device, state.hosts, applied); }
    catch {
      applied = { source: requested.source };
      try { caps = await window.scanner.capabilities(device, state.hosts, applied); }
      catch { applied = {}; caps = await window.scanner.capabilities(device, state.hosts); }
    }
  }
  state.capabilities = caps;
  for (const name of ['source', 'mode', 'resolution']) {
    const option = caps[name];
    let values = option?.values || [];
    if (name === 'resolution' && option?.range) {
      values = [...new Set([option.current, option.range.min, option.range.max, 75, 100, 150, 200, 300, 400, 600, 1200].map(Number).filter((value) => Number.isFinite(value) && value >= option.range.min && value <= option.range.max && Math.abs((value - option.range.min) / option.range.step - Math.round((value - option.range.min) / option.range.step)) < 0.00001))].sort((a, b) => a - b).map(String);
    }
    if (!values.length && option?.current && option.current !== 'inactive') values = [option.current];
    const preferred = values.includes(String(saved[name])) ? saved[name] : option?.current;
    setOptions(name, values, preferred);
  }
  state.advanced = { ...(saved.advanced || {}) };
  if (requested.customGamma !== undefined && applied.customGamma === undefined) delete state.advanced['custom-gamma'];
  renderAdvanced();
  if (!preservePreview) {
    updatePaperOptions(saved.paper);
    state.area = restoreArea(saved.area);
    updateAreaLabel();
    paintArea();
  }
  const selected = state.devices.find((item) => item.id === device);
  element('device-description').textContent = selected ? t('{device} on {endpoint}', selected) : '';
  updateControls();
  if (state.ready) savePreferences();
}

async function refreshDevices() {
  const previous = element('device').value || state.preferences.selectedDevice;
  const result = await window.scanner.listDevices(state.hosts);
  state.devices = result.devices;
  const select = element('device');
  select.replaceChildren();
  if (!state.devices.length) {
    select.add(new Option(t('No scanners found'), ''));
    element('device-description').textContent = t('Check your connection or add a network host.');
    state.capabilities = {};
    resetPreview();
    message(result.warnings.length ? result.warnings.map(errorText).join(' ') : 'No scanners found. Add a SANE server or discover one on the network.', result.warnings.length > 0);
    return;
  }
  if (previous && !state.devices.some((device) => device.id === previous)) select.add(new Option(t('Previously selected scanner unavailable'), ''));
  for (const device of state.devices) select.add(new Option(device.name, device.id));
  if (previous && !state.devices.some((device) => device.id === previous)) {
    state.capabilities = {}; state.area = null; resetPreview();
    for (const name of ['source', 'mode', 'resolution']) setOptions(name, [], '');
    element('advanced-options').replaceChildren(); element('device-description').textContent = t('The previously selected scanner is unavailable.');
    message('Select an available scanner or reconnect the previously selected device.', true); updateControls(); return;
  }
  if (previous) select.value = previous;
  await loadCapabilities();
  message(result.warnings.length ? result.warnings.map(errorText).join(' ') : t(state.devices.length === 1 ? '{count} scanner available.' : '{count} scanners available.', { count: state.devices.length }), result.warnings.length > 0);
}

function fullArea() {
  const caps = state.capabilities;
  if (!['l', 't', 'x', 'y'].every((name) => caps[name]?.range)) return null;
  return { l: caps.l.range.min, t: caps.t.range.min, x: caps.x.range.max, y: caps.y.range.max };
}

function request(area = state.area) {
  const advanced = {};
  for (const [name, value] of Object.entries(state.advanced)) if (state.capabilities.advanced?.[name]?.active) advanced[name] = value;
  return { device: element('device').value, hosts: state.hosts, options: { source: element('source').value, mode: element('mode').value, resolution: element('resolution').value, advanced }, area };
}

function renderPreview() {
  const index = state.pages.findIndex((page) => page.id === state.selectedPageId);
  const page = index < 0 ? null : state.pages[index];
  if (!page || state.cropPageId !== page.id) { state.cropPageId = null; state.cropBox = null; }
  if (page) dragStart = null;
  const image = page ? page.image : state.scannerPreview;
  element('scan-sheet').hidden = !image;
  element('empty-preview').hidden = Boolean(image);
  element('scan-sheet').classList.toggle('viewing-page', Boolean(page));
  element('scan-sheet').classList.toggle('cropping-page', Boolean(page && state.cropPageId === page.id));
  element('show-scanner-preview').hidden = !page || !state.scannerPreview;
  if (image !== state.shownImage) {
    state.shownImage = image; state.zoom = null; state.fitPreview = false;
    if (image) element('preview-image').src = image;
    updateZoomControls();
  }
  element('preview-image').alt = page ? t('Scanned page {number}', { number: index + 1 }) : t('Scanner preview');
  element('preview-hint').textContent = page ? (state.cropPageId === page.id ? t('Drag on the page to select an area to crop.') : t('Viewing page {number}.', { number: index + 1 })) : t(!image ? 'Preview your document to select an area.' : state.previewArea ? (element('paper').value === 'free' ? 'Drag on the preview to select an area.' : 'Drag the selection to move it.') : 'This scanner does not report adjustable scan bounds.');
  paintArea();
  renderRulers(); updateControls();
}

function currentRulerDpi() {
  return state.selectedPageId === null ? state.scannerPreviewDpi : state.pages.find((page) => page.id === state.selectedPageId)?.dpi;
}

function renderRulers() {
  const unit = state.preferences.rulerUnit || 'mm'; const dpi = currentRulerDpi();
  element('ruler-unit').textContent = unit;
  for (const name of ['mm', 'in', 'px']) element(`ruler-${name}`).setAttribute('aria-checked', String(unit === name));
  const image = element('preview-image'); const sheet = element('scan-sheet'); const stage = element('preview-stage');
  const rect = sheet.getBoundingClientRect(); const viewport = stage.getBoundingClientRect();
  const available = Boolean(state.shownImage && state.zoom !== null && image.naturalWidth && image.naturalHeight);
  element('ruler-status').hidden = !available || Boolean(window.rulerGeometry.unitsPerPixel(unit, dpi));
  for (const [axis, length, offset, visible, scale] of [
    ['x', image.naturalWidth, rect.left - viewport.left, stage.clientWidth, rect.width / image.naturalWidth],
    ['y', image.naturalHeight, rect.top - viewport.top, stage.clientHeight, rect.height / image.naturalHeight],
  ]) {
    const ticks = element(`ruler-${axis}-ticks`); ticks.replaceChildren();
    if (!available) continue;
    for (const tick of window.rulerGeometry.rulerTicks(length, offset, visible, scale, unit, dpi)) {
      const mark = document.createElement('div'); mark.className = `ruler-tick${tick.major ? ' major' : ''}`;
      mark.style[axis === 'x' ? 'left' : 'top'] = `${tick.position}px`;
      if (tick.major) { const label = document.createElement('span'); label.textContent = String(tick.value); mark.append(label); }
      ticks.append(mark);
    }
  }
  updateRulerIndicators();
}

function updateRulerIndicators() {
  const image = element('preview-image'); const stage = element('preview-stage');
  const rect = element('scan-sheet').getBoundingClientRect(); const viewport = stage.getBoundingClientRect();
  const offsets = { x: rect.left - viewport.left, y: rect.top - viewport.top };
  const box = state.shownImage && (state.selectedPageId === null || state.cropPageId === state.selectedPageId) ? state.selectionBox : null;
  const dpi = currentRulerDpi(); const unit = state.preferences.rulerUnit || 'mm';
  for (const axis of ['x', 'y']) {
    const selected = element(`ruler-${axis}-selection`); selected.hidden = !box;
    if (box) {
      const start = axis === 'x' ? box.left : box.top; const size = axis === 'x' ? box.width : box.height; const extent = axis === 'x' ? rect.width : rect.height;
      selected.style[axis === 'x' ? 'left' : 'top'] = `${offsets[axis] + start * extent}px`;
      selected.style[axis === 'x' ? 'width' : 'height'] = `${size * extent}px`;
    }
    const pointer = element(`ruler-${axis}-pointer`);
    const position = state.pointer && (axis === 'x' ? state.pointer.x - viewport.left : state.pointer.y - viewport.top);
    const inside = state.pointer && state.shownImage && state.pointer.x >= rect.left && state.pointer.x <= rect.right && state.pointer.y >= rect.top && state.pointer.y <= rect.bottom && state.pointer.x >= viewport.left && state.pointer.x <= viewport.left + stage.clientWidth && state.pointer.y >= viewport.top && state.pointer.y <= viewport.top + stage.clientHeight;
    pointer.hidden = !inside;
    if (inside) pointer.style[axis === 'x' ? 'left' : 'top'] = `${position}px`;
  }
  const size = element('ruler-size'); size.hidden = !box;
  if (box) {
    const width = window.rulerGeometry.formatSize(box.width * image.naturalWidth, unit, dpi);
    const height = window.rulerGeometry.formatSize(box.height * image.naturalHeight, unit, dpi);
    size.textContent = width === null || height === null ? t('Selection size unavailable (DPI unknown)') : t('Selection: {width} x {height} {unit}', { width, height, unit });
  }
}

function openRulerMenu(x, y) {
  const menu = element('ruler-menu'); menu.hidden = false;
  menu.style.left = `${Math.max(0, Math.min(x, window.innerWidth - menu.offsetWidth))}px`;
  menu.style.top = `${Math.max(0, Math.min(y, window.innerHeight - menu.offsetHeight))}px`;
  element('ruler-unit').setAttribute('aria-expanded', 'true');
  element(`ruler-${state.preferences.rulerUnit || 'mm'}`).focus();
}

function closeRulerMenu() {
  element('ruler-menu').hidden = true;
  element('ruler-unit').setAttribute('aria-expanded', 'false');
}

for (const id of ['ruler-x', 'ruler-y', 'ruler-unit']) element(id).addEventListener('contextmenu', (event) => { event.preventDefault(); openRulerMenu(event.clientX, event.clientY); });
element('ruler-unit').addEventListener('click', () => { const rect = element('ruler-unit').getBoundingClientRect(); openRulerMenu(rect.left, rect.bottom); });
for (const unit of ['mm', 'in', 'px']) element(`ruler-${unit}`).addEventListener('click', () => { state.preferences.rulerUnit = unit; savePreferences(); closeRulerMenu(); renderRulers(); element('ruler-unit').focus(); });
document.addEventListener('click', (event) => { if (!element('ruler-menu').contains(event.target) && event.target !== element('ruler-unit')) closeRulerMenu(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !element('ruler-menu').hidden) { closeRulerMenu(); element('ruler-unit').focus(); } });
element('ruler-menu').addEventListener('keydown', (event) => {
  const units = ['mm', 'in', 'px']; const index = units.findIndex((unit) => event.target === element(`ruler-${unit}`));
  if (index < 0 || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? units.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + units.length) % units.length;
  event.preventDefault(); element(`ruler-${units[next]}`).focus();
});

function updateZoomControls() {
  const image = element('preview-image');
  const available = Boolean(state.shownImage && state.zoom !== null && image.complete && image.naturalWidth && image.naturalHeight);
  for (const id of ['zoom-out', 'zoom-in', 'zoom-actual', 'zoom-fit']) element(id).disabled = !available;
  const percent = state.zoom * 100;
  element('zoom-value').textContent = available ? `${percent < 1 ? percent.toFixed(1) : Math.round(percent)}%` : '--';
}

function fitPreview() {
  const image = element('preview-image'); const stage = element('preview-stage');
  if (!state.shownImage || !image.naturalWidth || !image.naturalHeight || !stage.clientWidth || !stage.clientHeight) return;
  state.zoom = null;
  setZoom(Math.min(stage.clientWidth / image.naturalWidth, stage.clientHeight / image.naturalHeight), null, true);
  updateControls();
}

function setZoom(value, anchor = null, fit = false) {
  const image = element('preview-image'); const stage = element('preview-stage'); const sheet = element('scan-sheet');
  if (!state.shownImage || !image.naturalWidth || !image.naturalHeight) return;
  const rect = sheet.getBoundingClientRect(); const stageRect = stage.getBoundingClientRect();
  const point = anchor || { x: stageRect.left + stage.clientWidth / 2, y: stageRect.top + stage.clientHeight / 2 };
  const relative = { x: rect.width ? (point.x - rect.left) / rect.width : 0.5, y: rect.height ? (point.y - rect.top) / rect.height : 0.5 };
  const zoom = Math.max(0.001, Math.min(16, value));
  sheet.style.width = `${image.naturalWidth * zoom}px`;
  const updated = sheet.getBoundingClientRect();
  stage.scrollLeft += updated.left + relative.x * updated.width - point.x;
  stage.scrollTop += updated.top + relative.y * updated.height - point.y;
  state.zoom = zoom; state.fitPreview = fit;
  updateZoomControls();
  renderRulers();
}

element('preview-image').addEventListener('load', fitPreview);
element('zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.25));
element('zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.25));
element('zoom-actual').addEventListener('click', () => setZoom(1));
element('zoom-fit').addEventListener('click', fitPreview);
element('preview-stage').addEventListener('wheel', (event) => {
  if (!event.ctrlKey || !state.shownImage || state.zoom === null || !event.deltaY) return;
  event.preventDefault();
  setZoom(state.zoom * (event.deltaY < 0 ? 1.25 : 1 / 1.25), { x: event.clientX, y: event.clientY });
}, { passive: false });
element('preview-stage').addEventListener('scroll', renderRulers);
if (window.ResizeObserver) new window.ResizeObserver(() => { if (state.fitPreview) fitPreview(); else renderRulers(); }).observe(element('preview-stage'));

function renderPages() {
  const container = element('pages');
  container.replaceChildren();
  if (!state.pages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-pages';
    const icon = document.createElement('img'); icon.src = '../node_modules/lucide-static/icons/file-plus-2.svg'; icon.alt = '';
    const title = document.createElement('strong'); title.textContent = t('Your pages appear here');
    const detail = document.createElement('span'); detail.textContent = t('Scanned pages are collected in order.');
    empty.append(icon, title, detail); container.append(empty); return;
  }
  state.pages.forEach((page, index) => {
    const row = document.createElement('div'); row.className = 'page-item'; row.classList.toggle('selected', page.id === state.selectedPageId);
    const select = document.createElement('button'); select.type = 'button'; select.className = 'page-select'; select.setAttribute('aria-label', t('View page {number}', { number: index + 1 })); select.setAttribute('aria-pressed', String(page.id === state.selectedPageId));
    const image = document.createElement('img'); image.src = page.image; image.alt = t('Page {number}', { number: index + 1 });
    const info = document.createElement('div'); info.className = 'page-info'; info.textContent = t('Page {number}', { number: index + 1 });
    const detail = document.createElement('span'); detail.textContent = t('Scanned page'); info.append(detail);
    const actions = document.createElement('div'); actions.className = 'page-actions';
    for (const [action, icon, title, disabled] of [['up', 'chevron-up', 'Move page up', index === 0], ['down', 'chevron-down', 'Move page down', index === state.pages.length - 1], ['export', 'download', 'Export page', false], ['copy', 'copy', 'Copy page', false], ['remove', 'trash-2', 'Remove page', false]]) {
      const button = document.createElement('button'); button.className = 'icon-button'; button.title = t(title); button.setAttribute('aria-label', t(title)); button.disabled = disabled || state.busy;
      const image = document.createElement('img'); image.src = `../node_modules/lucide-static/icons/${icon}.svg`; image.alt = ''; button.append(image);
      button.addEventListener('click', () => operation(action === 'export' ? 'Exporting page...' : 'Updating pages...', async () => {
        if (action === 'export') {
          const saved = await window.scanner.exportPage({ id: page.id, ocr: element('ocr').checked, language: element('language').value });
          message(saved ? 'Page exported.' : 'Page export canceled.'); return;
        }
        if (action === 'copy') { await window.scanner.copyPage(page.id); message('Page copied.'); return; }
        if (action === 'remove') {
          await window.scanner.removePage(page.id); state.pages.splice(index, 1);
          if (state.selectedPageId === page.id) state.selectedPageId = state.pages[Math.min(index, state.pages.length - 1)]?.id ?? null;
        }
        else { const other = index + (action === 'up' ? -1 : 1); const reordered = [...state.pages]; [reordered[index], reordered[other]] = [reordered[other], reordered[index]]; await window.scanner.reorderPages(reordered.map((item) => item.id)); state.pages = reordered; }
        renderPreview(); renderPages(); message('');
      }));
      actions.append(button);
    }
    select.addEventListener('click', () => { state.selectedPageId = page.id; renderPreview(); renderPages(); container.children[index].firstElementChild.focus(); });
    select.append(image, info); row.append(select, actions); container.append(row);
  });
}

function pastePage() {
  return operation('Pasting image...', async () => {
    const page = await window.scanner.pastePage();
    state.pages.push(page); state.selectedPageId = page.id;
    renderPreview(); renderPages(); message('Image pasted.');
  });
}

element('paste-page').addEventListener('click', pastePage);
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'v' || event.target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '') || element('network-dialog').open) return;
  event.preventDefault();
  pastePage();
});

function drawSelection(start, end) {
  const left = Math.min(start.x, end.x); const top = Math.min(start.y, end.y);
  const width = Math.abs(start.x - end.x); const height = Math.abs(start.y - end.y);
  const selection = element('selection');
  state.selectionBox = { left, top, width, height };
  selection.hidden = false;
  Object.assign(selection.style, { left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` });
  updateRulerIndicators();
}

function updateAreaLabel() {
  element('area-label').textContent = state.area ? `${Number(state.area.x.toFixed(2))} x ${Number(state.area.y.toFixed(2))} ${state.capabilities.x?.unit === 1 ? 'px' : 'mm'}` : t('Full scan area');
}

function paintArea() {
  if (state.selectedPageId !== null && state.cropPageId === state.selectedPageId && state.cropBox) {
    const box = state.cropBox;
    drawSelection({ x: box.left, y: box.top }, { x: box.left + box.width, y: box.top + box.height }); return;
  }
  if (state.selectedPageId !== null || !state.area || !state.previewArea) { state.selectionBox = null; element('selection').hidden = true; updateRulerIndicators(); return; }
  const base = state.previewArea;
  drawSelection({ x: (state.area.l - base.l) / base.x, y: (state.area.t - base.t) / base.y }, { x: (state.area.l + state.area.x - base.l) / base.x, y: (state.area.t + state.area.y - base.t) / base.y });
}

function setArea(area) {
  state.area = area;
  updateAreaLabel(); paintArea(); updateControls(); savePreferences();
}

function coordinate(event) {
  const rect = element('scan-sheet').getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
}

function snap(value, range) {
  return window.paperGeometry.snap(value, range);
}

let dragStart = null;
element('scan-sheet').addEventListener('pointerdown', (event) => {
  if (state.busy) return;
  const point = coordinate(event);
  if (state.selectedPageId !== null) {
    if (state.cropPageId !== state.selectedPageId) return;
    state.cropBox = null; dragStart = { point, crop: true }; drawSelection(point, point); updateControls();
    event.currentTarget.setPointerCapture(event.pointerId); return;
  }
  if (!state.previewArea) return;
  if (element('paper').value !== 'free') {
    const area = state.area; const base = state.previewArea;
    if (!area || point.x < (area.l - base.l) / base.x || point.x > (area.l + area.x - base.l) / base.x || point.y < (area.t - base.t) / base.y || point.y > (area.t + area.y - base.t) / base.y) return;
    dragStart = { point, area: { ...area }, move: true };
  } else { dragStart = { point, move: false }; drawSelection(point, point); }
  event.currentTarget.setPointerCapture(event.pointerId);
});
element('scan-sheet').addEventListener('pointermove', (event) => {
  state.pointer = { x: event.clientX, y: event.clientY }; updateRulerIndicators();
  if (!dragStart) return;
  const point = coordinate(event);
  if (dragStart.move) {
    const base = state.previewArea;
    state.area = window.paperGeometry.presetArea(element('paper').value, state.capabilities, { l: dragStart.area.l + (point.x - dragStart.point.x) * base.x, t: dragStart.area.t + (point.y - dragStart.point.y) * base.y });
    updateAreaLabel(); paintArea();
  } else drawSelection(dragStart.point, point);
});
element('scan-sheet').addEventListener('pointerleave', () => { state.pointer = null; updateRulerIndicators(); });
element('scan-sheet').addEventListener('pointerup', (event) => {
  if (!dragStart) return;
  const end = coordinate(event); const drag = dragStart; dragStart = null;
  if (drag.crop) {
    const left = Math.min(drag.point.x, end.x); const top = Math.min(drag.point.y, end.y);
    const width = Math.abs(drag.point.x - end.x); const height = Math.abs(drag.point.y - end.y);
    state.cropBox = width >= .01 && height >= .01 ? { left, top, width, height } : null;
    paintArea(); updateControls(); return;
  }
  if (drag.move) { setArea(state.area); return; }
  const start = drag.point;
  const left = Math.min(start.x, end.x); const top = Math.min(start.y, end.y); const width = Math.abs(start.x - end.x); const height = Math.abs(start.y - end.y);
  if (width < .01 || height < .01) { setArea(null); return; }
  const base = state.previewArea; const caps = state.capabilities;
  const leftEdge = snap(base.l + left * base.x, caps.l.range); const topEdge = snap(base.t + top * base.y, caps.t.range);
  const rightEdge = snap(base.l + (left + width) * base.x, caps['br-x'].range); const bottomEdge = snap(base.t + (top + height) * base.y, caps['br-y'].range);
  if (rightEdge <= leftEdge || bottomEdge <= topEdge) { setArea(null); return; }
  setArea({ l: leftEdge, t: topEdge, x: rightEdge - leftEdge, y: bottomEdge - topEdge });
});

element('reset-area').addEventListener('click', () => { element('paper').value = 'free'; setArea(null); });
element('page-crop').addEventListener('click', () => { if (!state.busy && state.selectedPageId !== null) { state.cropPageId = state.selectedPageId; state.cropBox = null; renderPreview(); } });
element('page-crop-cancel').addEventListener('click', () => { state.cropPageId = null; state.cropBox = null; renderPreview(); });
for (const [id, action] of [['page-rotate-left', 'rotate-left'], ['page-rotate-right', 'rotate-right'], ['page-deskew', 'deskew'], ['page-crop-apply', 'crop'], ['page-undo', 'undo']]) {
  element(id).addEventListener('click', () => operation('Editing page...', async () => {
    const pageId = state.selectedPageId;
    const result = await window.scanner.editPage({ id: pageId, action, crop: action === 'crop' ? state.cropBox : undefined });
    const index = state.pages.findIndex((page) => page.id === pageId);
    if (index >= 0) state.pages[index] = result.page;
    if (state.selectedPageId === pageId) { state.cropPageId = null; state.cropBox = null; renderPreview(); }
    renderPages(); message(result.changed ? 'Page updated.' : 'No confident skew detected.');
  }));
}
element('cancel-scan').addEventListener('click', async () => {
  if (!state.scanning || element('cancel-scan').disabled) return;
  element('cancel-scan').disabled = true; setScanProgress(t('Canceling scan...'), null);
  try { await window.scanner.cancelScan(); } catch (error) { message(errorText(error.message), true); }
});
element('show-scanner-preview').addEventListener('click', () => { state.selectedPageId = null; renderPreview(); renderPages(); });
element('refresh').addEventListener('click', () => operation('Looking for scanners...', refreshDevices));
element('device').addEventListener('change', () => operation('Reading scanner settings...', async () => { await loadCapabilities(); message('Scanner ready.'); }));
for (const name of ['source', 'mode']) element(name).addEventListener('change', () => {
  savePreferences();
  operation('Updating scanner settings...', async () => { await loadCapabilities(); message('Scanner settings updated.'); });
});
element('resolution').addEventListener('change', savePreferences);
element('paper').addEventListener('change', () => {
  const size = element('paper').value;
  if (size === 'free') { setArea(null); return; }
  const area = window.paperGeometry.presetArea(size, state.capabilities);
  if (!area) { element('paper').value = 'free'; message('This paper size does not fit the scanner area.', true); setArea(null); return; }
  setArea(area);
});
element('preview').addEventListener('click', () => operation('Creating preview...', async () => {
  const scanRequest = request(fullArea());
  if (/feeder|adf/i.test(scanRequest.options.source)) {
    const flatbed = state.capabilities.source?.values.find((value) => /flatbed/i.test(value));
    if (flatbed) scanRequest.options.source = flatbed;
    else if (!confirm(t('Preview will consume one sheet from the feeder. Continue?'))) { message('Preview canceled.'); return; }
  }
  const preview = await window.scanner.preview(scanRequest);
  if (preview.canceled) { message('Preview canceled.'); return; }
  state.previewArea = scanRequest.area;
  state.scannerPreview = preview.image; state.scannerPreviewDpi = preview.dpi; state.selectedPageId = null;
  updateAreaLabel(); renderPreview(); renderPages();
  message('Preview ready.');
}, true));
element('scan').addEventListener('click', () => operation('Scanning...', async () => {
  const result = await window.scanner.scan({ ...request(), feeder: element('feeder').checked });
  state.pages.push(...result.pages);
  if (result.pages.length) state.selectedPageId = result.pages[result.pages.length - 1].id;
  renderPreview(); renderPages(); message(result.canceled ? t(result.pages.length === 1 ? 'Scan canceled. {count} page added.' : 'Scan canceled. {count} pages added.', { count: result.pages.length }) : result.warning ? errorText(result.warning) : t(result.pages.length === 1 ? '{count} page added.' : '{count} pages added.', { count: result.pages.length }), Boolean(result.warning));
}, true));
element('ocr').addEventListener('change', () => { element('language-field').hidden = !element('ocr').checked; savePreferences(); });
element('language').addEventListener('change', savePreferences);
element('feeder').addEventListener('change', savePreferences);
element('export').addEventListener('click', () => operation('Preparing PDF...', async () => {
  const saved = await window.scanner.exportPdf({ ocr: element('ocr').checked, language: element('language').value });
  message(saved ? 'PDF exported.' : 'Export canceled.');
}));

function renderHosts() {
  const list = element('host-list'); list.replaceChildren();
  for (const host of state.hosts) {
    const row = document.createElement('div'); row.className = 'host-item';
    const label = document.createElement('span'); label.textContent = host;
    const remove = document.createElement('button'); remove.className = 'icon-button'; remove.title = t('Remove {host}', { host }); remove.setAttribute('aria-label', remove.title);
    const icon = document.createElement('img'); icon.src = '../node_modules/lucide-static/icons/x.svg'; icon.alt = ''; remove.append(icon);
    remove.addEventListener('click', async () => { state.hosts = state.hosts.filter((item) => item !== host); await window.scanner.setHosts(state.hosts); renderHosts(); });
    row.append(label, remove); list.append(row);
  }
}
element('network-open').addEventListener('click', () => { renderHosts(); element('network-feedback').textContent = ''; element('network-dialog').showModal(); });
element('host-add').addEventListener('click', async () => {
  const host = element('host-input').value.trim();
  try { const hosts = [...new Set([...state.hosts, host])]; await window.scanner.setHosts(hosts); state.hosts = hosts; element('host-input').value = ''; element('network-feedback').textContent = t('Host added. Close this window to refresh scanners.'); renderHosts(); }
  catch (error) { element('network-feedback').textContent = errorText(error.message); }
});
element('discover').addEventListener('click', async () => {
  const button = element('discover'); button.disabled = true; element('network-feedback').textContent = t('Searching...');
  try {
    const found = await window.scanner.discoverHosts(); state.hosts = [...new Set([...state.hosts, ...found])]; await window.scanner.setHosts(state.hosts); renderHosts();
    element('network-feedback').textContent = found.length ? t(found.length === 1 ? 'Found {count} server.' : 'Found {count} servers.', { count: found.length }) : t('No SANE servers found via mDNS. You can add a host manually.');
  } catch (error) { element('network-feedback').textContent = errorText(error.message); } finally { button.disabled = false; }
});
element('network-dialog').addEventListener('close', () => operation('Looking for scanners...', refreshDevices));
window.scanner.onProgress((progress) => {
  if (typeof progress === 'string') message(progress);
  else if (state.scanning && progress && typeof progress.message === 'string') setScanProgress(progress.message, progress.percent);
});

operation('Looking for scanners...', async () => {
  state.locale = window.i18n.resolveLocale(await window.scanner.getLocale());
  localizeDocument(); updateAreaLabel(); renderPages(); updateControls(); message('Looking for scanners...');
  state.hosts = await window.scanner.getHosts();
  state.preferences = await window.scanner.getSettings();
  renderRulers();
  try { const langs = await window.scanner.languages(); setOptions('language', langs, langs.includes('eng') ? 'eng' : langs[0]); state.ocrAvailable = langs.length > 0; }
  catch { element('language').add(new Option(t('Tesseract not available'), '')); }
  if (!state.ocrAvailable) element('ocr-detail').textContent = t('Install Tesseract and language data to enable OCR.');
  if (Array.from(element('language').options).some((option) => option.value === state.preferences.language)) element('language').value = state.preferences.language;
  element('ocr').checked = state.ocrAvailable && state.preferences.ocr;
  element('language-field').hidden = !element('ocr').checked;
  element('feeder').checked = state.preferences.feeder;
  if (!state.hosts.length) {
    try { state.hosts = await window.scanner.discoverHosts(); await window.scanner.setHosts(state.hosts); } catch {}
  }
  state.ready = true;
  await refreshDevices();
});
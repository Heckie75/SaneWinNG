'use strict';

const element = (id) => document.getElementById(id);
const state = { hosts: [], devices: [], capabilities: {}, pages: [], area: null, previewArea: null, busy: false, ocrAvailable: false, ready: false, advanced: {}, invalid: new Set(), preferences: { selectedDevice: '', scanners: {}, ocr: false, language: '', feeder: false } };
const controls = ['device', 'source', 'mode', 'resolution', 'preview', 'scan', 'refresh', 'network-open', 'export', 'feeder', 'ocr'];

function message(text, error = false) {
  element('feedback').textContent = text;
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
  element('page-count').textContent = state.pages.length;
  element('page-summary').textContent = state.pages.length ? `${state.pages.length} ${state.pages.length === 1 ? 'page' : 'pages'} ready` : 'No pages yet';
  element('connection-status').textContent = scannerReady ? 'Scanner connected' : selected ? 'Scanner unavailable' : 'No scanner selected';
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
  window.scanner.setSettings(state.preferences).catch((error) => message(`Could not save settings: ${error.message}`, true));
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
    const note = document.createElement('span'); note.className = 'option-note'; note.textContent = 'No advanced settings available.'; container.append(note); return;
  }
  for (const [name, option] of Object.entries(options)) {
    const labelText = advancedLabels[name] || option.title || name;
    if (option.active && option.readable && !validAdvanced(option, state.advanced[name])) {
      const current = option.type === 0 ? option.current : option.type === 3 ? option.current : Array.isArray(option.current) ? option.current : option.current === '' ? undefined : Number(option.current);
      if (validAdvanced(option, current)) state.advanced[name] = current;
      else delete state.advanced[name];
    }
    const wrapper = document.createElement('div'); wrapper.className = 'advanced-option';
    const note = document.createElement('small'); note.className = 'option-note'; note.setAttribute('aria-live', 'polite');
    const available = option.active && option.settable;
    const prepare = (control) => { control.dataset.unavailable = available ? 'false' : 'true'; control.disabled = state.busy || !available; control.title = option.description || labelText; };
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
      const textarea = document.createElement('textarea'); textarea.setAttribute('aria-label', labelText); textarea.spellcheck = false; textarea.placeholder = `${option.count} comma-separated values`; textarea.value = Array.isArray(state.advanced[name]) ? state.advanced[name].join(', ') : ''; prepare(textarea);
      details.append(summary, textarea); wrapper.append(details);
      if (option.range && option.count > 1 && !option.values.length) {
        const linear = document.createElement('button'); linear.type = 'button'; linear.className = 'button secondary gamma-linear'; linear.textContent = 'Linear'; linear.title = `Generate a linear ${labelText.toLowerCase()}`; linear.disabled = state.busy || !available; linear.dataset.unavailable = available ? 'false' : 'true'; details.append(linear);
        linear.addEventListener('click', () => {
          const { min, max, step } = option.range;
          const values = Array.from({ length: option.count }, (_, index) => Number(Math.min(max, min + Math.round(((max - min) * index / (option.count - 1)) / step) * step).toFixed(4)));
          textarea.value = values.join(', '); textarea.dispatchEvent(new Event('input'));
        });
      }
      const description = option.range ? `${option.count} values, ${option.range.min} to ${option.range.max}.` : `${option.count} values.`;
      note.textContent = !available ? 'Unavailable with current scanner settings.' : option.readable ? description : `${description} Leave empty to retain the scanner default.`;
      textarea.addEventListener('input', () => {
        const text = textarea.value.trim();
        if (!text) { delete state.advanced[name]; state.invalid.delete(name); note.textContent = description; note.classList.remove('option-error'); textarea.removeAttribute('aria-invalid'); savePreferences(); updateControls(); return; }
        const parts = text.split(/[\s,]+/);
        const values = parts.map(Number);
        if (!parts.every((part) => /^-?\d+(?:\.\d+)?$/.test(part)) || !validAdvanced(option, values)) { state.invalid.add(name); note.textContent = `Enter ${description.toLowerCase()}`; note.classList.add('option-error'); textarea.setAttribute('aria-invalid', 'true'); }
        else { state.advanced[name] = values; state.invalid.delete(name); note.textContent = description; note.classList.remove('option-error'); textarea.removeAttribute('aria-invalid'); savePreferences(); }
        updateControls();
      });
    } else if (option.type === 3 || (!option.range && option.values.length)) {
      const label = document.createElement('label'); label.textContent = labelText;
      const select = document.createElement('select'); select.setAttribute('aria-label', labelText); prepare(select);
      for (const value of option.values) select.add(new Option(value, value));
      if (validAdvanced(option, state.advanced[name])) select.value = String(state.advanced[name]);
      label.append(select); wrapper.append(label);
      select.addEventListener('change', () => { state.advanced[name] = option.type === 3 ? select.value : Number(select.value); savePreferences(); });
    } else if (option.range) {
      const label = document.createElement('label'); label.textContent = labelText;
      const row = document.createElement('div'); row.className = 'number-control';
      const slider = document.createElement('input'); slider.type = 'range'; slider.setAttribute('aria-label', `${labelText} slider`);
      const input = document.createElement('input'); input.type = 'number'; input.setAttribute('aria-label', labelText);
      for (const control of [slider, input]) { control.min = option.range.min; control.max = option.range.max; control.step = option.range.step; control.value = state.advanced[name] ?? option.range.min; prepare(control); }
      row.append(slider, input); label.append(row); wrapper.append(label);
      const update = (source) => {
        const value = Number(source.value);
        if (source.value === '' || !source.checkValidity() || !validAdvanced(option, value)) { state.invalid.add(name); input.setAttribute('aria-invalid', 'true'); note.textContent = `Enter a value from ${option.range.min} to ${option.range.max} in steps of ${option.range.step}.`; note.classList.add('option-error'); }
        else { input.value = value; slider.value = value; state.advanced[name] = value; state.invalid.delete(name); input.removeAttribute('aria-invalid'); note.textContent = ''; note.classList.remove('option-error'); savePreferences(); }
        updateControls();
      };
      slider.addEventListener('input', () => update(slider)); input.addEventListener('input', () => update(input));
    } else continue;
    if (!available) note.textContent = 'Unavailable with current scanner settings.';
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
  state.busy = true;
  state.scanning = scanning;
  if (scanning) { setScanProgress(label, null); element('scan-progress-container').hidden = false; }
  message(label);
  updateControls();
  try { await task(); } catch (error) { message(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true); }
  finally { state.busy = false; state.scanning = false; element('scan-progress-container').hidden = true; renderPages(); updateControls(); }
}

function setOptions(id, values, selected) {
  const select = element(id);
  select.replaceChildren();
  if (!values.length) {
    select.add(new Option('Not available', ''));
    return;
  }
  for (const value of values) select.add(new Option(id === 'resolution' ? `${value} dpi` : value, value));
  select.value = values.includes(String(selected)) ? String(selected) : values[0];
}

function resetPreview() {
  state.previewArea = null;
  element('scan-sheet').hidden = true;
  element('empty-preview').hidden = false;
  element('selection').hidden = true;
  updateAreaLabel();
  element('preview-hint').textContent = 'Preview your document to select an area.';
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
  element('device-description').textContent = selected ? `${selected.device} on ${selected.endpoint}` : '';
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
    select.add(new Option('No scanners found', ''));
    element('device-description').textContent = 'Check your connection or add a network host.';
    state.capabilities = {};
    resetPreview();
    message(result.warnings.length ? result.warnings.join(' ') : 'No scanners found. Add a SANE server or discover one on the network.', result.warnings.length > 0);
    return;
  }
  if (previous && !state.devices.some((device) => device.id === previous)) select.add(new Option('Previously selected scanner unavailable', ''));
  for (const device of state.devices) select.add(new Option(device.name, device.id));
  if (previous && !state.devices.some((device) => device.id === previous)) {
    state.capabilities = {}; state.area = null; resetPreview();
    for (const name of ['source', 'mode', 'resolution']) setOptions(name, [], '');
    element('advanced-options').replaceChildren(); element('device-description').textContent = 'The previously selected scanner is unavailable.';
    message('Select an available scanner or reconnect the previously selected device.', true); updateControls(); return;
  }
  if (previous) select.value = previous;
  await loadCapabilities();
  message(result.warnings.length ? result.warnings.join(' ') : `${state.devices.length} ${state.devices.length === 1 ? 'scanner' : 'scanners'} available.`, result.warnings.length > 0);
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

function renderPages() {
  const container = element('pages');
  container.replaceChildren();
  if (!state.pages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-pages';
    const icon = document.createElement('img'); icon.src = '../node_modules/lucide-static/icons/file-plus-2.svg'; icon.alt = '';
    const title = document.createElement('strong'); title.textContent = 'Your pages appear here';
    const detail = document.createElement('span'); detail.textContent = 'Scanned pages are collected in order.';
    empty.append(icon, title, detail); container.append(empty); return;
  }
  state.pages.forEach((page, index) => {
    const row = document.createElement('div'); row.className = 'page-item';
    const image = document.createElement('img'); image.src = page.image; image.alt = `Page ${index + 1}`;
    const info = document.createElement('div'); info.className = 'page-info'; info.textContent = `Page ${index + 1}`;
    const detail = document.createElement('span'); detail.textContent = 'Scanned page'; info.append(detail);
    const actions = document.createElement('div'); actions.className = 'page-actions';
    for (const [action, icon, title, disabled] of [['up', 'chevron-up', 'Move page up', index === 0], ['down', 'chevron-down', 'Move page down', index === state.pages.length - 1], ['remove', 'trash-2', 'Remove page', false]]) {
      const button = document.createElement('button'); button.className = 'icon-button'; button.title = title; button.setAttribute('aria-label', title); button.disabled = disabled || state.busy;
      const image = document.createElement('img'); image.src = `../node_modules/lucide-static/icons/${icon}.svg`; image.alt = ''; button.append(image);
      button.addEventListener('click', () => operation('Updating pages...', async () => {
        if (action === 'remove') { await window.scanner.removePage(page.id); state.pages.splice(index, 1); }
        else { const other = index + (action === 'up' ? -1 : 1); const reordered = [...state.pages]; [reordered[index], reordered[other]] = [reordered[other], reordered[index]]; await window.scanner.reorderPages(reordered.map((item) => item.id)); state.pages = reordered; }
        renderPages(); message('');
      }));
      actions.append(button);
    }
    row.append(image, info, actions); container.append(row);
  });
}

function drawSelection(start, end) {
  const left = Math.min(start.x, end.x); const top = Math.min(start.y, end.y);
  const width = Math.abs(start.x - end.x); const height = Math.abs(start.y - end.y);
  const selection = element('selection');
  selection.hidden = false;
  Object.assign(selection.style, { left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` });
}

function updateAreaLabel() {
  element('area-label').textContent = state.area ? `${Number(state.area.x.toFixed(2))} x ${Number(state.area.y.toFixed(2))} ${state.capabilities.x?.unit === 1 ? 'px' : 'mm'}` : 'Full scan area';
}

function paintArea() {
  if (!state.area || !state.previewArea) { element('selection').hidden = true; return; }
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
  if (!state.previewArea || state.busy) return;
  const point = coordinate(event);
  if (element('paper').value !== 'free') {
    const area = state.area; const base = state.previewArea;
    if (!area || point.x < (area.l - base.l) / base.x || point.x > (area.l + area.x - base.l) / base.x || point.y < (area.t - base.t) / base.y || point.y > (area.t + area.y - base.t) / base.y) return;
    dragStart = { point, area: { ...area }, move: true };
  } else { dragStart = { point, move: false }; drawSelection(point, point); }
  event.currentTarget.setPointerCapture(event.pointerId);
});
element('scan-sheet').addEventListener('pointermove', (event) => {
  if (!dragStart) return;
  const point = coordinate(event);
  if (dragStart.move) {
    const base = state.previewArea;
    state.area = window.paperGeometry.presetArea(element('paper').value, state.capabilities, { l: dragStart.area.l + (point.x - dragStart.point.x) * base.x, t: dragStart.area.t + (point.y - dragStart.point.y) * base.y });
    updateAreaLabel(); paintArea();
  } else drawSelection(dragStart.point, point);
});
element('scan-sheet').addEventListener('pointerup', (event) => {
  if (!dragStart) return;
  const end = coordinate(event); const drag = dragStart; dragStart = null;
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
    else if (!confirm('Preview will consume one sheet from the feeder. Continue?')) { message('Preview canceled.'); return; }
  }
  const image = await window.scanner.preview(scanRequest);
  state.previewArea = scanRequest.area;
  element('preview-image').src = image; element('scan-sheet').hidden = false; element('empty-preview').hidden = true; element('selection').hidden = true;
  updateAreaLabel(); paintArea();
  element('preview-hint').textContent = state.previewArea ? (element('paper').value === 'free' ? 'Drag on the preview to select an area.' : 'Drag the selection to move it.') : 'This scanner does not report adjustable scan bounds.';
  message('Preview ready.');
}, true));
element('scan').addEventListener('click', () => operation('Scanning...', async () => {
  const result = await window.scanner.scan({ ...request(), feeder: element('feeder').checked });
  state.pages.push(...result.pages); renderPages(); message(result.warning || `${result.pages.length} ${result.pages.length === 1 ? 'page' : 'pages'} added.`, Boolean(result.warning));
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
    const remove = document.createElement('button'); remove.className = 'icon-button'; remove.title = `Remove ${host}`; remove.setAttribute('aria-label', `Remove ${host}`);
    const icon = document.createElement('img'); icon.src = '../node_modules/lucide-static/icons/x.svg'; icon.alt = ''; remove.append(icon);
    remove.addEventListener('click', async () => { state.hosts = state.hosts.filter((item) => item !== host); await window.scanner.setHosts(state.hosts); renderHosts(); });
    row.append(label, remove); list.append(row);
  }
}
element('network-open').addEventListener('click', () => { renderHosts(); element('network-feedback').textContent = ''; element('network-dialog').showModal(); });
element('host-add').addEventListener('click', async () => {
  const host = element('host-input').value.trim();
  try { const hosts = [...new Set([...state.hosts, host])]; await window.scanner.setHosts(hosts); state.hosts = hosts; element('host-input').value = ''; element('network-feedback').textContent = 'Host added. Close this window to refresh scanners.'; renderHosts(); }
  catch (error) { element('network-feedback').textContent = error.message; }
});
element('discover').addEventListener('click', async () => {
  const button = element('discover'); button.disabled = true; element('network-feedback').textContent = 'Searching...';
  try {
    const found = await window.scanner.discoverHosts(); state.hosts = [...new Set([...state.hosts, ...found])]; await window.scanner.setHosts(state.hosts); renderHosts();
    element('network-feedback').textContent = found.length ? `Found ${found.length} ${found.length === 1 ? 'server' : 'servers'}.` : 'No SANE servers found via mDNS. You can add a host manually.';
  } catch (error) { element('network-feedback').textContent = error.message; } finally { button.disabled = false; }
});
element('network-dialog').addEventListener('close', () => operation('Looking for scanners...', refreshDevices));
window.scanner.onProgress((progress) => {
  if (typeof progress === 'string') message(progress);
  else if (state.scanning && progress && typeof progress.message === 'string') setScanProgress(progress.message, progress.percent);
});

operation('Looking for scanners...', async () => {
  state.hosts = await window.scanner.getHosts();
  state.preferences = await window.scanner.getSettings();
  try { const langs = await window.scanner.languages(); setOptions('language', langs, langs.includes('eng') ? 'eng' : langs[0]); state.ocrAvailable = langs.length > 0; }
  catch { element('language').add(new Option('Tesseract not available', '')); }
  if (!state.ocrAvailable) element('ocr-detail').textContent = 'Install Tesseract and language data to enable OCR.';
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
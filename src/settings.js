'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { validateHosts } = require('./backend');

const ADVANCED = new Set(['custom-gamma', 'gamma-table', 'red-gamma-table', 'green-gamma-table', 'blue-gamma-table', 'brightness', 'contrast', 'lamp-off-time', 'lamp-off-scan', 'color-filter']);

function validatePreferences(preferences) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences) || JSON.stringify(preferences).length > 2 * 1024 * 1024) throw new Error('Invalid preferences.');
  const { selectedDevice = '', scanners = {}, ocr = false, language = '', feeder = false, rulerUnit = 'mm' } = preferences;
  if (typeof selectedDevice !== 'string' || selectedDevice.length > 8192 || !scanners || typeof scanners !== 'object' || Array.isArray(scanners) || Object.keys(scanners).length > 100 || typeof ocr !== 'boolean' || typeof feeder !== 'boolean' || typeof language !== 'string' || !/^[\w+-]{0,100}$/.test(language) || !['mm', 'in', 'px'].includes(rulerUnit)) throw new Error('Invalid preferences.');
  const savedScanners = {};
  for (const [id, scanner] of Object.entries(scanners)) {
    if (!/^[\w-]{1,8192}$/.test(id) || !scanner || typeof scanner !== 'object' || Array.isArray(scanner)) throw new Error('Invalid scanner preferences.');
    const { source = '', mode = '', resolution = '', paper = 'free', area = null, advanced = {} } = scanner;
    if ([source, mode, resolution, paper].some((value) => typeof value !== 'string' || value.length > 4096) || !advanced || typeof advanced !== 'object' || Array.isArray(advanced)) throw new Error('Invalid scanner preferences.');
    if (area !== null && (!area || typeof area !== 'object' || Array.isArray(area) || !['l', 't', 'x', 'y'].every((name) => typeof area[name] === 'number' && Number.isFinite(area[name])))) throw new Error('Invalid saved scan area.');
    const savedAdvanced = {};
    for (const [name, value] of Object.entries(advanced)) {
      if (!ADVANCED.has(name) || !(typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 4096) || (Array.isArray(value) && value.length <= 65536 && value.every((item) => typeof item === 'number' && Number.isFinite(item))))) throw new Error('Invalid advanced preferences.');
      savedAdvanced[name] = value;
    }
    savedScanners[id] = { source, mode, resolution, paper, area: area && { l: area.l, t: area.t, x: area.x, y: area.y }, advanced: savedAdvanced };
  }
  return { selectedDevice, scanners: savedScanners, ocr, language, feeder, rulerUnit };
}

class SettingsStore {
  constructor(file) { this.file = file; this.pending = Promise.resolve(); }

  async read() {
    await this.pending;
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')); } catch { return {}; }
  }

  update(changes) {
    this.pending = this.pending.catch(() => {}).then(async () => {
      let existing;
      try { existing = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch { existing = {}; }
      const settings = { ...existing, ...changes };
      const temporary = path.join(path.dirname(this.file), 'settings.tmp');
      await fs.writeFile(temporary, JSON.stringify(settings));
      await fs.rename(temporary, this.file);
    });
    return this.pending;
  }

  setHosts(hosts) { return this.update({ hosts: validateHosts(hosts) }); }
  setPreferences(preferences) { return this.update({ preferences: validatePreferences(preferences) }); }
}

module.exports = { SettingsStore, validatePreferences };
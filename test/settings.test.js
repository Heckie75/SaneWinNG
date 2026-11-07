'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore, validatePreferences } = require('../src/settings');

test('preserves hosts and per-scanner preferences across concurrent updates', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sanewin-settings-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new SettingsStore(path.join(directory, 'settings.json'));
  const preferences = { selectedDevice: 'device1', scanners: { device1: { source: 'Flatbed', mode: 'Color', resolution: '300', paper: 'a4-portrait', area: { l: 0, t: 0, x: 210, y: 297 }, advanced: { 'custom-gamma': true, 'gamma-table': [0, 100], brightness: 12 } } }, ocr: true, language: 'eng', feeder: false };
  await Promise.all([store.setHosts(['scanner.local:6567']), store.setPreferences(preferences)]);
  const reopened = await new SettingsStore(store.file).read();
  assert.deepEqual(reopened.hosts, ['scanner.local:6567']);
  assert.deepEqual(reopened.preferences, preferences);
});

test('rejects invalid preference values', () => {
  assert.throws(() => validatePreferences({ scanners: { scanner: { advanced: { brightness: Infinity } } } }), /Invalid/);
  assert.throws(() => validatePreferences({ scanners: { scanner: { advanced: { arbitrary: 1 } } } }), /Invalid/);
  assert.throws(() => validatePreferences({ scanners: { scanner: { area: { l: 0, t: 0, x: NaN, y: 1 } } } }), /Invalid/);
});
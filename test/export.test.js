'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultPdfName, offerOpenPdf } = require('../src/export');

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
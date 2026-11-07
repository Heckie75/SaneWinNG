'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { unitsPerPixel, rulerTicks, formatSize } = require('../src/ruler');

test('converts scan pixels using the actual DPI and rejects unknown physical resolution', () => {
  assert.equal(formatSize(300, 'mm', 300), '25.4');
  assert.equal(formatSize(150, 'mm', 150), '25.4');
  assert.equal(formatSize(300, 'in', 300), '1');
  assert.equal(formatSize(300, 'px', null), '300');
  assert.equal(unitsPerPixel('mm', null), null);
  assert.equal(formatSize(300, 'in', 0), null);
});

test('ruler ticks follow zoom and scrolling and only cover the image', () => {
  const ticks = rulerTicks(1200, -150, 300, 0.5, 'px', null);
  assert.ok(ticks.length > 0);
  assert.ok(ticks.every((tick) => tick.position >= 0 && tick.position <= 300));
  assert.ok(ticks.some((tick) => tick.major && tick.value === 400 && tick.position === 50));
  assert.deepEqual(rulerTicks(1200, 0, 300, 0.5, 'mm', null), []);
  const millimeters = rulerTicks(300, 20, 300, 1, 'mm', 300);
  assert.ok(millimeters.some((tick) => tick.major && tick.value === 0 && tick.position === 20));
});
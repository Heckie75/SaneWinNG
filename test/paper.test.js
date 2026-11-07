'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { presetArea, snap } = require('../src/paper');

function capabilities(width, height, step = 0.1) {
  const range = (max) => ({ range: { min: 0, max, step }, unit: 3 });
  return { l: range(width), t: range(height), x: range(width), y: range(height), 'br-x': range(width), 'br-y': range(height) };
}

test('places portrait and landscape paper at the top left and moves within bounds', () => {
  const caps = capabilities(300, 400);
  assert.deepEqual(presetArea('a4-portrait', caps), { l: 0, x: 210, t: 0, y: 297 });
  assert.deepEqual(presetArea('a4-landscape', caps, { l: 50, t: 250 }), { l: 3, x: 297, t: 190, y: 210 });
  const letter = presetArea('letter-portrait', caps);
  assert.equal(letter.l, 0);
  assert.equal(letter.t, 0);
  assert.ok(Math.abs(letter.x - 215.9) < 0.000001);
  assert.ok(Math.abs(letter.y - 279.4) < 0.000001);
});

test('rejects paper that does not fit or cannot be expressed in millimeters', () => {
  const caps = capabilities(200, 300);
  assert.equal(presetArea('a4-portrait', caps), null);
  caps.l.unit = 1;
  assert.equal(presetArea('a5-portrait', caps), null);
});

test('keeps snapped coordinates inside fractional scanner limits', () => {
  const range = { min: 0, max: 216.6999969482422, step: 0.01 };
  assert.ok(snap(range.max, range) <= range.max);
  assert.equal(snap(range.max, range), 216.69);
  const fine = { min: 0, max: 1, step: 1 / 65536 };
  assert.equal(snap(0.5, fine), 0.5);
});
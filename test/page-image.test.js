'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { analyzeSkew } = require('skew-score');
const { editImage } = require('../src/page-image');

test('rotates and crops image pixels without losing content', async () => {
  const image = await sharp(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]), { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer();
  const rotated = await editImage(image, 'rotate-right');
  const decoded = await sharp(rotated.image).removeAlpha().raw().toBuffer();
  assert.deepEqual([...decoded], [0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 255, 0]);
  const left = await editImage(image, 'rotate-left');
  assert.deepEqual([...(await sharp(left.image).removeAlpha().raw().toBuffer())], [0, 255, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255]);
  const cropped = await editImage(image, 'crop', { left: 0.5, top: 0, width: 0.5, height: 1 });
  const result = await sharp(cropped.image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(result.info.width, 1);
  assert.equal(result.info.height, 2);
  assert.deepEqual([...result.data], [0, 255, 0, 255, 255, 255]);
  await assert.rejects(editImage(image, 'crop', { left: 0.8, top: 0, width: 0.5, height: 1 }), /Invalid crop/);
  await assert.rejects(editImage(image, 'unknown'), /Invalid page edit/);
});

test('deskews tilted text lines and leaves blank images unchanged', async () => {
  const width = 900; const height = 700; const pixels = Buffer.alloc(width * height * 3, 255);
  for (let row = 80; row < 620; row += 48) for (let y = row; y < row + 6; y++) for (let x = 80; x < 820; x++) if (x % 27 < 19) pixels.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3);
  const straight = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const tilted = await sharp(straight).rotate(4, { background: '#ffffff' }).png().toBuffer();
  const corrected = await editImage(tilted, 'deskew');
  assert.equal(corrected.changed, true);
  assert.ok(Math.abs(corrected.angle + 4) <= 0.5);
  const result = await analyzeSkew(corrected.image, { maxAngle: 10, angleStep: 0.5 });
  assert.ok(Math.abs(result.angle) <= 0.5);
  const blank = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ffffff' } }).png().toBuffer();
  assert.equal((await editImage(blank, 'deskew')).changed, false);
});
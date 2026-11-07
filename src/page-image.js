'use strict';

const sharp = require('sharp');
const { analyzeSkew } = require('skew-score');

const MAX_PIXELS = 60 * 1024 * 1024;
const MAX_BYTES = 250 * 1024 * 1024;

async function editImage(image, action, crop) {
  if (!Buffer.isBuffer(image) || image.length > MAX_BYTES) throw new Error('Invalid page image.');
  if (!['rotate-left', 'rotate-right', 'crop', 'deskew'].includes(action)) throw new Error('Invalid page edit.');
  const input = sharp(image, { limitInputPixels: MAX_PIXELS });
  const { width, height, format } = await input.metadata();
  if (format !== 'png' || !width || !height || width * height > MAX_PIXELS) throw new Error('Invalid page image.');
  let pipeline;
  let angle = 0;
  if (action === 'crop') {
    if (!crop || typeof crop !== 'object' || Array.isArray(crop) || !['left', 'top', 'width', 'height'].every((name) => typeof crop[name] === 'number' && Number.isFinite(crop[name])) || crop.left < 0 || crop.top < 0 || crop.width <= 0 || crop.height <= 0 || crop.left + crop.width > 1 + Number.EPSILON * 4 || crop.top + crop.height > 1 + Number.EPSILON * 4) throw new Error('Invalid crop area.');
    const left = Math.floor(crop.left * width); const top = Math.floor(crop.top * height);
    const right = Math.min(width, Math.ceil((crop.left + crop.width) * width));
    const bottom = Math.min(height, Math.ceil((crop.top + crop.height) * height));
    pipeline = input.extract({ left, top, width: right - left, height: bottom - top });
  } else {
    if (action === 'deskew') {
      const result = await analyzeSkew(image, { maxAngle: 10, angleStep: 0.5, angleThreshold: 0.5 });
      if (!result.isSkewed || result.confidence < 0.5) return { image, changed: false, angle: 0 };
      angle = result.correctiveRotation;
    } else angle = action === 'rotate-left' ? -90 : 90;
    const radians = Math.abs(angle) * Math.PI / 180;
    const rotatedWidth = Math.abs(angle) === 90 ? height : Math.ceil(width * Math.abs(Math.cos(radians)) + height * Math.abs(Math.sin(radians)));
    const rotatedHeight = Math.abs(angle) === 90 ? width : Math.ceil(width * Math.abs(Math.sin(radians)) + height * Math.abs(Math.cos(radians)));
    if (rotatedWidth * rotatedHeight > MAX_PIXELS) throw new Error('Edited page exceeds the image size limit.');
    pipeline = input.rotate(angle, { background: '#ffffff' });
  }
  const result = await pipeline.png().toBuffer();
  if (result.length > MAX_BYTES) throw new Error('Edited page exceeds the 250 MB limit.');
  return { image: result, changed: true, angle };
}

module.exports = { editImage };
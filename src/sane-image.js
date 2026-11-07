'use strict';

const { PNG } = require('pngjs');

function encodeFrames(frames) {
  if (!frames.length) throw new Error('Scanner returned no image frames.');
  const first = frames[0];
  const formats = frames.map((frame) => frame.params.format);
  if (!(formats.length === 1 && [0, 1].includes(formats[0])) && !(formats.length === 3 && [2, 3, 4].every((format) => formats.includes(format)))) throw new Error('Unsupported or incomplete scan image frames.');
  const { width, bytesPerLine, depth } = first.params;
  const height = first.params.lines < 0 ? first.data.length / bytesPerLine : first.params.lines;
  if (!Number.isInteger(height) || width < 1 || height < 1 || width * height > 340 * 1024 * 1024 || ![1, 8, 16].includes(depth)) throw new Error('Unsupported or oversized scan image.');
  const png = new PNG({ width, height });
  for (const frame of frames) {
    const params = frame.params;
    const channels = params.format === 1 ? 3 : 1;
    if (![0, 1, 2, 3, 4].includes(params.format) || params.width !== width || params.depth !== depth || params.bytesPerLine < Math.ceil(width * channels * depth / 8) || frame.data.length !== params.bytesPerLine * height) throw new Error('Unsupported or incomplete scan image frame.');
    if (depth === 1 && channels !== 1) throw new Error('Unsupported one-bit color scan.');
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const pixel = (row * width + column) * 4;
        for (let channel = 0; channel < channels; channel++) {
          const sample = column * channels + channel;
          const offset = row * params.bytesPerLine + Math.floor(sample * depth / 8);
          const value = depth === 1 ? (1 - ((frame.data[offset] >> (7 - (sample % 8))) & 1)) * 255 : depth === 8 ? frame.data[offset] : frame.data[offset + (frame.byteOrder === 0x1234 ? 1 : 0)];
          if (params.format === 0) png.data.fill(value, pixel, pixel + 3);
          else png.data[pixel + (params.format === 1 ? channel : params.format - 2)] = value;
        }
        png.data[pixel + 3] = 255;
      }
    }
  }
  return PNG.sync.write(png);
}

module.exports = { encodeFrames };
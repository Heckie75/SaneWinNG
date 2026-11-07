'use strict';

const paperSizes = {
  'a3-portrait': [297, 420], 'a3-landscape': [420, 297],
  'a4-portrait': [210, 297], 'a4-landscape': [297, 210],
  'a5-portrait': [148, 210], 'a5-landscape': [210, 148],
  'a6-portrait': [105, 148], 'a6-landscape': [148, 105],
  'letter-portrait': [215.9, 279.4], 'letter-landscape': [279.4, 215.9],
  'legal-portrait': [215.9, 355.6], 'legal-landscape': [355.6, 215.9],
};

function align(value, range, direction = 'round') {
  const steps = (value - range.min) / range.step;
  const rounded = direction === 'floor' ? Math.floor(steps + 0.000001) : Math.round(steps);
  return range.min + rounded * range.step;
}

function snap(value, range) {
  const maximum = Math.floor((range.max - range.min) / range.step + 0.00000001);
  const steps = Math.max(0, Math.min(maximum, Math.round((value - range.min) / range.step)));
  return Math.max(range.min, Math.min(range.max, range.min + steps * range.step));
}

function presetArea(name, capabilities, position) {
  const dimensions = paperSizes[name];
  if (!dimensions || !['l', 't', 'x', 'y', 'br-x', 'br-y'].every((name) => capabilities[name]?.range && capabilities[name].unit === 3)) return null;
  const axes = [['l', 'br-x', dimensions[0]], ['t', 'br-y', dimensions[1]]];
  const result = {};
  for (const [startName, endName, size] of axes) {
    const start = capabilities[startName].range;
    const end = capabilities[endName].range;
    if (size > end.max - start.min + 0.0001) return null;
    const maxStart = Math.min(start.max, end.max - size);
    const requested = position?.[startName] ?? start.min;
    const alignedStart = Math.max(start.min, Math.min(align(Math.max(start.min, requested), start), align(maxStart, start, 'floor')));
    const alignedEnd = Math.min(end.max, Math.max(end.min, align(alignedStart + size, end)));
    if (alignedEnd <= alignedStart) return null;
    result[startName] = alignedStart;
    result[startName === 'l' ? 'x' : 'y'] = alignedEnd - alignedStart;
  }
  return result;
}

const paperGeometry = { paperSizes, presetArea, snap };
if (typeof module !== 'undefined') module.exports = paperGeometry;
else window.paperGeometry = paperGeometry;
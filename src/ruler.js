'use strict';

function unitsPerPixel(unit, dpi) {
  if (unit === 'px') return 1;
  if (!Number.isFinite(dpi) || dpi <= 0) return null;
  if (unit === 'mm') return 25.4 / dpi;
  if (unit === 'in') return 1 / dpi;
  return null;
}

function rulerTicks(length, offset, viewport, scale, unit, dpi) {
  const conversion = unitsPerPixel(unit, dpi);
  if (!conversion || !Number.isFinite(scale) || scale <= 0 || length <= 0 || viewport <= 0) return [];
  const target = 60 * conversion / scale;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const major = [1, 2, 5, 10].find((factor) => factor * magnitude >= target) * magnitude;
  const minor = major / 5;
  const first = Math.max(0, Math.ceil(-offset * conversion / scale / minor));
  const last = Math.min(Math.floor(length * conversion / minor), Math.floor((viewport - offset) * conversion / scale / minor));
  const ticks = [];
  for (let index = first; index <= last; index++) {
    ticks.push({ position: offset + index * minor / conversion * scale, value: Number((index * minor).toPrecision(10)), major: index % 5 === 0 });
  }
  return ticks;
}

function formatSize(pixels, unit, dpi) {
  const conversion = unitsPerPixel(unit, dpi);
  if (!conversion) return null;
  const decimals = unit === 'px' ? 0 : unit === 'in' ? 3 : 2;
  return Number((pixels * conversion).toFixed(decimals)).toString();
}

const rulerGeometry = { unitsPerPixel, rulerTicks, formatSize };
if (typeof module !== 'undefined') module.exports = rulerGeometry;
else window.rulerGeometry = rulerGeometry;
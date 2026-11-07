'use strict';

const path = require('node:path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');

function defaultPdfName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `SaneWin-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.pdf`;
}

async function offerOpenPdf(dialog, shell, window, filePath, t = (text) => text) {
  const result = await dialog.showMessageBox(window, { type: 'question', title: t('PDF exported'), message: t('Open the exported PDF?'), buttons: [t('Open PDF'), t('Not now')], defaultId: 0, cancelId: 1, noLink: true });
  if (result.response !== 0) return;
  const error = await shell.openPath(filePath);
  if (error) throw new Error(`PDF saved, but could not be opened: ${error}`);
}

function pageExportFormat(filePath) {
  if (typeof filePath !== 'string') throw new Error('Choose a PNG, JPG, JPEG, or PDF filename.');
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'png';
  if (extension === '.jpg' || extension === '.jpeg') return 'jpeg';
  if (extension === '.pdf') return 'pdf';
  throw new Error('Choose a PNG, JPG, JPEG, or PDF filename.');
}

async function exportPageData(page, format, options, recognize) {
  if (!page || !Buffer.isBuffer(page.image) || !['png', 'jpeg', 'pdf'].includes(format)) throw new Error('Invalid page export.');
  if (format === 'pdf') {
    const pdf = await PDFDocument.create();
    if (options.ocr) {
      const recognized = await PDFDocument.load(await recognize(page.image, options.language, page.dpi));
      const copied = await pdf.copyPages(recognized, recognized.getPageIndices());
      copied.forEach((item) => pdf.addPage(item));
    } else {
      const image = await pdf.embedPng(page.image);
      const pdfPage = pdf.addPage([image.width * 72 / page.dpi, image.height * 72 / page.dpi]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: pdfPage.getWidth(), height: pdfPage.getHeight() });
    }
    return Buffer.from(await pdf.save());
  }
  if (format === 'png' && !page.rulerDpi) return page.image;
  let pipeline = sharp(page.image, { limitInputPixels: 340 * 1024 * 1024 });
  if (Number.isFinite(page.rulerDpi) && page.rulerDpi >= 1 && page.rulerDpi <= 100000) pipeline = pipeline.withMetadata({ density: Math.round(page.rulerDpi) });
  const result = await (format === 'png' ? pipeline.png() : pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 90 })).toBuffer();
  if (result.length > 1024 * 1024 * 1024) throw new Error('Exported page exceeds the 1 GB limit.');
  return result;
}

module.exports = { defaultPdfName, offerOpenPdf, pageExportFormat, exportPageData };
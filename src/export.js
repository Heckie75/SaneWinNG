'use strict';

function defaultPdfName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `SaneWin-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.pdf`;
}

async function offerOpenPdf(dialog, shell, window, filePath) {
  const result = await dialog.showMessageBox(window, { type: 'question', title: 'PDF exported', message: 'Open the exported PDF?', buttons: ['Open PDF', 'Not now'], defaultId: 0, cancelId: 1, noLink: true });
  if (result.response !== 0) return;
  const error = await shell.openPath(filePath);
  if (error) throw new Error(`PDF saved, but could not be opened: ${error}`);
}

module.exports = { defaultPdfName, offerOpenPdf };
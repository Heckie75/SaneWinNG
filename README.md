# SaneWin NG

A Windows desktop scanning application for scanners shared by a [SANE](http://www.sane-project.org/) server. Select a scanner, preview and select an area, collect and reorder pages, and export a PDF with optional Tesseract OCR. Scanner support and options depend on the remote SANE backend and device.

## Windows setup

Install the Windows application and open it. It connects directly to a remote Linux `saned` server; neither WSL, SSH, nor a SANE installation is required on Windows. The network button can discover servers advertising `_sane-port._tcp` via mDNS, or add a server manually as `scanner.local`, `192.168.1.10:6566`, or `[2001:db8::1]:6566`. The default port is 6566. Discovery depends on multicast and server advertisements; manual entry works without them.

On the Linux server, install and configure SANE and `saned`, confirm `scanimage -L` lists the scanner, and allow the Windows client's address in `saned.conf`. Permit the control port and the server's configured data-port range through the firewall; scanning opens a separate data connection. SANE network traffic is unencrypted, including image data. Use a trusted network or VPN. SANE servers requiring interactive authentication are not supported yet.

For optional OCR, install a native Windows build of [Tesseract](https://github.com/UB-Mannheim/tesseract/wiki) with the desired language data, add its installation directory to `PATH`, and restart the app. Check with `tesseract --list-langs` in a new PowerShell window. OCR is disabled if Tesseract or its language data is unavailable. The installer does not bundle Tesseract.

For development on Windows, install Node.js 22, run `npm ci`, then `npm start`. Build an unsigned Windows installer with `npm run dist:win`; the result is in `dist/`.

## Development container

Open the folder in VS Code and choose **Dev Containers: Reopen in Container**. The container installs Node.js, SANE utilities, Tesseract with English and German data, Avahi utilities, and the dependencies for Electron. Dependencies are installed automatically; use `npm start` and `npm test` in the container.

Running the Electron window inside a Linux container requires an accessible X11 display and permission for the container to connect. The container configuration forwards `DISPLAY` and `/tmp/.X11-unix`; this assumes a local Linux X11 host and may need adjustment for Wayland, Windows, macOS, or a remote Docker host. Container sandbox restrictions can require `npm start -- --no-sandbox`; only use this in a trusted development environment. Multicast discovery can depend on Docker networking; add the server address manually if needed. Building a Windows installer from Linux may require Wine.

For a hardware-free network pipeline check, run:

```sh
SANEWIN_INTEGRATION=1 npm test
```

The integration test starts a local `saned` process with the SANE test backend, scans over TCP, and runs Tesseract. It requires `saned`, the test backend, and English Tesseract data. The regular unit tests do not require scanner hardware.

## Scanner settings and workflow

The application reads supported **source** (flatbed or feeder), **color mode** (such as color, gray, or lineart), **resolution**, and scan-area bounds from each SANE backend. The advanced section exposes supported custom gamma tables, brightness, contrast, lamp settings, and color filter. Options unavailable in the current mode are disabled. Gamma tables accept the exact number and range of values reported by the scanner; the **Linear** button can supply a starting table. Some devices cannot return their current gamma table, in which case leaving the field empty keeps the device default.

Preview uses a low resolution and the full reported scan area. Choose a paper size to place a fixed-size selection at the top left and drag it to move it, or use free selection and drag a rectangle. Paper sizes that cannot fit the reported scanner area are disabled; presets require geometry reported in millimeters. When a flatbed is available it is used for preview even if the feeder is selected. If only a feeder is available, a preview consumes a sheet. For an automatic document feeder, select its source and enable **Scan entire feeder**; scanning stops when the backend reports an empty feeder or after 100 pages. Backends differ in their empty-feeder errors, so any other error is shown and already scanned pages are kept. Canceling a scan closes the active SANE connection, discards the incomplete page, and keeps completed pages; a feeder may already have consumed the interrupted sheet.

The interface follows the system light or dark setting and automatically uses English, German, French, or Spanish based on the system language, falling back to English for other languages. Translations are included locally and do not require a network connection. Scanner-provided names, descriptions, and external diagnostic details may remain in their original language. The interface language is separate from the selected OCR language. During scanning, progress reflects the image data received for the current frame; it is indeterminate when the scanner cannot report the image size.

Clicking a scanned page shows it in the preview area without changing the next scan area; new scans are selected automatically. Zoom with the toolbar buttons (zoom out, zoom in, 100%) or the mouse; the selection scales with the image. Rulers along the preview show the pointer position and selected area, in millimeters, inches, or pixels (right-click a ruler to switch; the choice is saved). They use the scan DPI; a notice is shown when it is unknown and the chosen unit cannot be computed.

Use the page controls to reorder or remove scans. Select a scanned page to rotate it, choose and apply a crop, or attempt automatic deskew; deskew targets small tilts up to 10 degrees and needs clear line structure. Page edits replace the in-memory page and have one undo level per page; retaining that previous image increases memory usage. Crop selection is separate from the next scan area. The per-page export icon saves PNG, JPG/JPEG, or a single-page PDF according to the filename extension; PDF uses the selected OCR setting. The existing PDF export creates a document in page order, suggests a timestamped filename, and offers to open the saved document. OCR runs locally using the selected Tesseract language and adds searchable text. Server addresses, scanner selections, scan settings, areas, and export options are saved in the application's user-data directory; scanned pages themselves are held in memory until the app closes, so export before quitting. Large scans, editing, and long documents can use significant memory; individual command output is limited to 1 GB, and a single scanned page to 1 GB of image data (about 340 megapixels).

Use the copy icon on a page to copy its image to the system clipboard. Paste an image as a new page using the paste icon beside Pages or Ctrl+V. DPI is read from clipboard image metadata when available; otherwise the ruler reports unknown DPI and PDF export uses 300 DPI. Clipboard formats and applications may discard image DPI metadata.

## Current limitations

- No direct local USB, native WIA/TWAIN support, automatic document rotation, or persistent scan sessions. A local scanner must be shared through a reachable SANE server.
- SANE network authentication is not supported. Sixteen-bit scanner data is currently converted to eight bits per channel for PNG and PDF output.
- Selection requires the SANE backend to report adjustable geometry. Settings and feeder error messages vary between devices.
- Device detection and scans can take time, particularly when a network host is offline. Device discovery and PDF export cannot be canceled.
- The application has not been tested with every SANE backend, physical scanner, Windows configuration, or multi-page feeder.
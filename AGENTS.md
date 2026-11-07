# Agent Guide

## Project

SaneWin NG is an Electron desktop client for SANE scanners. Its core workflow is scanner discovery and selection, device-dependent settings, preview and area selection, multipage scanning, and PDF export with optional local Tesseract OCR. See `README.md` for setup, usage, and current limitations.

## Development and verification

- Develop in the VS Code devcontainer defined in `.devcontainer/`. It provides Node.js 22, SANE, Tesseract, Avahi utilities, and Electron's Linux dependencies.
- Run `npm test` for unit tests. Run `SANEWIN_INTEGRATION=1 npm test` to also exercise a scan and OCR through SANE's `test:0` backend; this requires that backend and English Tesseract data to be available.
- Run `npm start` to launch Electron. An Electron window in the container requires a usable display; see the README for X11 and sandbox caveats.
- Run `npm run dist:win` to build the Windows installer in `dist/`. Without a devcontainer, build on Linux with `docker run --rm -v "$PWD":/project -w /project electronuserland/builder:wine sh -c "npm test && npm run dist:win"`. Releases bump `version` in `package.json` and `package-lock.json` (lines 3 and 9 only) and keep only the current version in `dist/`. The installer is unsigned and does not bundle WSL, SANE, Tesseract, or OCR data.
- When changing scanner or export behavior, add focused tests and run the integration test where feasible. Report separately whether Windows, physical scanners, network discovery, and document feeders were actually tested.
- Keep `package-lock.json` in sync with dependency changes. Do not edit generated `node_modules/` or `dist/` files.

## Architecture

- `src/main.js`: Electron window, IPC handlers, in-memory pages, and PDF export.
- `src/preload.js`: explicit renderer-facing IPC bridge.
- `src/renderer.js`, `src/index.html`, `src/styles.css`: desktop UI, preview selection, and page management.
- `src/backend.js`: scanner operations, mDNS discovery, endpoint validation, and native Tesseract execution.
- `src/sane-net.js`, `src/sane-image.js`: SANE network protocol, scan data, and image encoding.
- `src/paper.js`, `src/settings.js`, `src/export.js`: paper geometry, saved preferences, and PDF export helpers.
- `src/i18n.js`: local en/de/fr/es translations and system-locale selection (English fallback). Add every new UI string, tooltip, and aria-label for all four languages.
- `src/ruler.js`: preview ruler unit conversion (mm/in/px) from scan DPI; the chosen unit is persisted in settings.
- `src/page-image.js`: page edit helpers (rotate, crop, deskew via `skew-score`) using `sharp`.
- Preview has two distinct modes: scanner preview (drives the next scan area) and viewing a scanned page (must not change scan area). Zoom scales image and selection together; keep pointer-to-scanner-area mapping correct at all zoom levels.
- `test/`: Node test runner unit tests and opt-in SANE/OCR integration test.

## Engineering constraints

- Preserve Electron's context isolation, renderer sandbox, disabled Node integration, restrictive content security policy, and narrow preload API. Validate IPC inputs and avoid exposing arbitrary filesystem or subprocess access to the renderer.
- SANE connections are direct TCP, not WSL or SSH. Invoke Tesseract with argument arrays and validate network inputs. SANE's network protocol is unencrypted, so do not imply that network scans are encrypted.
- Capabilities and errors vary by SANE backend. Use reported options and geometry rather than assuming a particular device; preserve already scanned pages if a feeder scan fails.
- Preview selection maps to scanner geometry, while OCR and PDF page dimensions depend on scan resolution. Test these relationships when modifying scanning, cropping, or export.
- Scanner and export preferences are persisted per user; scanned pages live in memory and are lost on exit. Respect existing output limits, and make any changes to page persistence, large-document handling, or cancellation explicit.
- Native WIA/TWAIN support and direct USB access are not implemented; do not present them as available without implementing and testing them.
- Keep the existing desktop UI style and use its local fonts and Lucide icons. Maintain accessible labels, disabled/loading states, and usable layouts when adding controls.
# Next Release

All items below are required for the release after 0.4.0.

## Scanned Page Preview

- [x] Clicking a scanned page in the page list selects it and displays that image in the preview section.
- [x] Select and display newly scanned pages automatically, including when scanning without first creating a preview. Handle multipage scans, page reordering, and removal consistently.
- [x] Keep scanner-preview area selection distinct from viewing an already scanned page, so viewing a page does not unexpectedly change the next scan area or exported pages.

## Preview Zoom

- [x] Add dedicated zoom-out, zoom-in, and 100% controls, plus mouse-based zooming.
- [x] By default, the image uses the full viewport of the application window
- [x] Scale the image and selection box together. Keep pointer coordinates and scanner-area mapping accurate at every zoom level, including when the preview is scrolled.
- [x] Verify zooming and selection in scanner-preview and scanned-page views, with light and dark themes and at different window sizes.

## Preview Rulers

- [x] Show horizontal and vertical rulers alongside the preview, aligned with the image when zooming or scrolling.
- [x] Default to millimeters and allow switching between millimeters, inches, and pixels through a ruler context menu.
- [x] Calculate ruler measurements using the image's scan DPI, including for previously scanned pages; handle unavailable DPI without presenting inaccurate measurements.
- [x] there is an indicator in the ruler that represents the position of the mouse.
- [x] The selected rectangle is visually highlighted in the ruler. The size of the selected area is also displayed. The displayed unit applies the unit of the ruler. 
- [x] Persist the selected ruler unit across application restarts.
- [x] Test ruler alignment, unit conversion at different scan resolutions, and persistence.

## Interface Languages

- [x] Support English, German, French, and Spanish throughout the application, including controls, tooltips, dialogs, status messages, validation errors, and accessibility labels.
- [x] Choose the language from the Windows system language, with English as the fallback for unsupported languages. Keep translations local and available offline.
- [x] Test supported locale selection, fallback behavior, and layouts with longer translated text.

## Verification

- [x] Add focused automated tests for page selection, zoom/selection geometry, localization, and locale fallback.
- [x] Run `npm test` and, where feasible, `SANEWIN_INTEGRATION=1 npm test`. Report whether Windows, physical scanners, network discovery, and document feeders were tested.

Verified on Linux using the SANE test backend and Tesseract. Windows, physical scanners, network discovery, and document feeders were not tested.
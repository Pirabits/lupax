# LupaX

Capture and inspect web pages in Chrome (Manifest V3): screenshots, recordings, CSS styles, assets and accessibility checks, for designers and developers.

## Load it

1. Download `lupax-<version>.zip` from the [latest release](https://github.com/danbaez/lupax/releases/latest) and unzip it (or clone this repo).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the unzipped folder (or this repo's folder).
4. Pin LupaX. Shortcuts: `chrome://extensions/shortcuts`.

Requires Chrome 116+.

## Features

| Area | Feature | How |
|---|---|---|
| Capture | Visible area · Selected region · Full page · Scrolling capture · Delayed (3/5/10 s) · Element capture · Desktop screenshot | `captureVisibleTab` + scroll-and-stitch on `OffscreenCanvas`; desktop via `desktopCapture` |
| Capture | PNG / JPG / PDF, annotate after capture, auto copy to clipboard, save destination (Downloads / Ask / preview only), recent captures | `lib/pdf.js` (JPEG-in-PDF writer), `viewer.html` editor |
| Editor | Pen, highlighter, arrow, line, rectangle, ellipse, text, blur/pixelate, crop, move/delete, undo/redo, keyboard shortcuts | `viewer.js` |
| Record | Tab / Window / Desktop, microphone, tab/system audio, webcam bubble, cursor highlight, countdown, quality 720p–4K, 24/30/60 fps, pause/resume | Tab: `tabCapture` → offscreen doc; window/desktop: `desktopCapture` in `recorder.html`; webcam composited with insertable streams (`lib/compose.js`) |
| Inspect | Inspect Mode (hover, pin, ↑/↓ parent/child, box model, contrast, Copy CSS) | `content/inspector.js` |
| Inspect | Color palette with roles, RGB/HSL, contrast on white · Typography groups (H1…Body, Link, Button) · Spacing scale, radii, shadows · Components (buttons, inputs, cards, links) · Picked colors | `lib/scan.js#scanStyles` |
| Inspect | Export tokens: W3C design-token JSON, CSS variables, Tailwind theme · Copy all values | `popup.js` |
| Assets | Images, SVGs (incl. inline), fonts, icons, backgrounds with sizes · select · paginate · download · Export ZIP | `lib/scan.js#scanAssets`, `lib/zip.js` |
| Accessibility | Score, passed/issues/warnings; contrast (AA), alt text, form labels, button/link names, lang/title, zoom, headings, duplicate IDs, readability · detailed report with “Show on page” highlight · JSON export | `lib/scan.js#scanA11y`, `report.html` |
| Other | Quick Mode menu, history (`history.html`), settings (`settings.html`), help & shortcuts | |

## Notes & limits

- Chrome popups max out at 800×600 px, so long views (Capture, Style Inspector) scroll with a pinned action button.
- Tab recording with mic/webcam needs a one-time grant (`permissions.html`) because offscreen documents can’t show permission prompts. The popup opens it before recording; the record shortcut opens it when a grant is missing.
- Site access: LupaX has no standing access to websites (no “read and change all your data” warning at install). Chrome gives it access to a tab when you click the LupaX icon or use one of its shortcuts there, and keeps it through reloads and pages on the same site until the tab goes to another site. ZIP export asks for access to the sites the assets come from (`optional_host_permissions`) and gives that access back when the export ends (also at the next start, if the export never finished); if declined, assets from sites that allow cross-site downloads (CORS) are still exported. Asset sizes and font previews in the popup appear for sites that allow CORS. Asset requests never carry the user's cookies.
- `chrome://` pages and the Web Store can’t be scanned, inspected or scroll-captured; on `chrome://` pages a visible-area screenshot works.
- Scroll-and-stitch uses window scrolling; inner scroll containers capture one viewport.
- Cursor highlight is drawn in the page, so it shows in tab recordings and in screen recordings only over the browser tab.
- Recordings are WebM, with the duration written into the file when it is saved (MediaRecorder leaves it out, which leaves players unable to show the length or seek; `lib/webm.js`). They are written to IndexedDB in 1-second chunks while recording, so long recordings don't live in memory; if a recording is interrupted (browser crash, recorder window closed, extension updated), the chunks are recovered into history as `…-recovered.webm`: right away for a closed recorder window or an update, otherwise on the next browser start.
- History keeps the latest 60 screenshots/exports and 20 recordings (`HISTORY_LIMITS` in `lib/db.js`). Captures waiting for Save in the editor are kept for 24 hours (`PENDING_TTL_MS`), then count toward the limit like any other capture. Downloaded files are not affected.
- Auto copy to clipboard is skipped for images over 20 MB (the toast says so).
- ZIP export: up to 10,000 assets and 1 GB per export, 100 MB per asset (larger ones are skipped and counted in the toast); the writer has no Zip64. File names come from the page, so control and bidi characters are removed and the extension must suit the asset type (an “image” named `setup.exe` is saved as `setup_exe.bin`).
- Errors appear as a toast in the page, with the toolbar badge (`!`) and tooltip as a fallback on pages Chrome won't let extensions script.

## Development

No build step and no runtime dependencies; the extension loads straight from this folder. Node 22+ is only needed for tests.

```sh
npm test            # unit tests (node:test) — zip, pdf, webm, color, format, settings, history limits, tokens, WCAG parity
npm run test:e2e    # end-to-end: real Chrome + this extension + tests/e2e/fixtures/site.html  (~50 s, headless)
npm run test:e2e -- --headed        # watch it run
npm run test:e2e -- --only record   # run tests whose name contains "record"
```

The e2e harness (`tests/e2e/`) loads the extension with the DevTools `Extensions.loadUnpacked` command over `--remote-debugging-pipe` (branded Chrome ignores `--load-extension`) and passes `--allowlisted-extension-id` so tab recording works without a toolbar click. Tests click the toolbar icon on the fixture tab (`Extensions.triggerAction`) to give LupaX access to it, as a user would. It covers capture modes and formats, downloads, area/element selection, inspect mode, color picker, the editor, tab recording, recording failure cleanup, stopping a recording at the first failed chunk write, one-recording-at-a-time during setup, crash recovery, history limits, ZIP export (including a hanging asset), popup escaping of page-controlled CSS and the accessibility score. Set `CHROME_PATH` if Chrome isn't in the default location, and `EXTENSION_DIR` to run the suite against another copy of the extension.

Not covered automatically: window/desktop recording and desktop screenshots (they need a choice in Chrome's screen picker), and mic/webcam capture.

Layout:

| Path | What |
|---|---|
| `background.js` | Service worker: message router, captures and stitching, recording control, ZIP export, error reporting |
| `offscreen.js` | Tab recording (MediaRecorder) and `blob:` URLs for downloads (service workers can't create them) |
| `recorder.js` | Window/desktop recording and desktop screenshots |
| `popup.js`, `popup/core.js`, `popup/views/*.js` | Popup entry, shared state/router, one module per view |
| `popup/tokens.js` | Design-token export (JSON / CSS / Tailwind) |
| `lib/` | Shared modules; `lib/scan.js` holds functions injected into pages, which must stay self-contained (their copied WCAG math is pinned by `tests/unit/wcag-parity.test.mjs`) |

`npm run package` builds the Web Store upload, `dist/lupax-<version>.zip`: the git-tracked extension files only (no `tests/`, `scripts/`, `docs/`, `package.json` or `README.md`) plus `LICENSE` and `NOTICE`, with `manifest.json` at the root. Bump `version` in `manifest.json` before each upload, attach the same zip to a GitHub release (`gh release create v<version> dist/lupax-<version>.zip`), and update the Download link in `docs/index.html`. The website, [lupax.app](https://lupax.app), is the `docs/` folder served by GitHub Pages from `main`: `docs/index.html` (landing page) and `docs/privacy.html` (the privacy policy linked from the store listing). It loads nothing from other servers; its font and icons are copied into `docs/assets/`.

Font: Plus Jakarta Sans (SIL Open Font License 1.1), bundled in `fonts/` with its license, `fonts/OFL.txt`, which must ship with it.

## License & trademarks

Copyright 2026 Pirabits LLC. The code is licensed under the [Apache License 2.0](LICENSE): you can use, modify and redistribute it, including commercially, as long as you keep the copyright notices and the [NOTICE](NOTICE) file.

The license covers the code, not the brand. "LupaX", the LupaX logo and icons are trademarks of Pirabits LLC and are not licensed for use in other products: a fork must use its own name and icons. See [TRADEMARKS.md](TRADEMARKS.md).

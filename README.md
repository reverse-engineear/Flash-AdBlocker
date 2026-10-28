# Chrome extensions

Manifest V3 extensions for Chrome and other Chromium browsers, one folder per extension.

| Extension | Version | Folder |
| --- | --- | --- |
| [Flash AdBlocker](extensions/flash-adblocker/README.md) — ad/tracker blocker with 200k+ domain rulesets, cosmetic filtering, per-site allowlist, and YouTube player ad stripping | 2.2.0 | [`extensions/flash-adblocker`](extensions/flash-adblocker) |

## Layout

```
extensions/<name>/        one self-contained extension; manifest.json sits at its root
.github/workflows/        optional CI, one job per extension folder
```

Each extension folder is independent: its own `manifest.json`, scripts, rules, icons, and README. Nothing is shared between extensions, so a build never needs files from outside its folder.

## Install for development

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked**.
3. Select `extensions/<name>` — the folder holding that extension's `manifest.json`, not this repository root.
4. No build step; the committed files are what Chrome loads.

## Add a new extension

1. Create `extensions/<name>/` with a `manifest.json` at its top level and all paths inside it relative to that folder.
2. Add `extensions/<name>/README.md` describing what it does and how it was verified.
3. Add a row to the table above.

## Publish

Zip the contents of a single extension folder (so `manifest.json` is at the zip root, not nested under a directory) and upload it to the Chrome Web Store. Each extension keeps its own store item, so its listing, icons, and promo assets stay separate.

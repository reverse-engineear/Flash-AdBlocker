# Chrome extensions

Manifest V3 extensions for Chrome and other Chromium browsers, one folder per extension.

| Extension | Version | Folder |
| --- | --- | --- |
| [Flash AdBlocker](extensions/flash-adblocker/README.md) — ad/tracker blocker with 200k+ domain rulesets, cosmetic filtering, per-site allowlist, and YouTube player ad stripping | 2.2.0 | [`extensions/flash-adblocker`](extensions/flash-adblocker) |

## Layout

```
extensions/<name>/        one self-contained extension; manifest.json sits at its root
tools/                    Node scripts shared by every extension (validation, packaging)
.github/workflows/        CI that builds every extension folder into its own artifacts
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
4. Releases are tagged `v<version>` for the whole repository, so keep each extension's version distinct, or move to `<name>-v<version>` tags once two extensions would collide.

## Publish

Zip the contents of a single extension folder (so `manifest.json` is at the zip root, not nested under a directory) and upload it to the Chrome Web Store. Each extension keeps its own store item, so its listing, icons, and promo assets stay separate.

## Builds

[`build.yml`](.github/workflows/build.yml) finds every folder under `extensions/` that has a `manifest.json`, validates it with [`tools/validate.mjs`](tools/validate.mjs), and uploads a store-ready ZIP per extension with Chrome's `_metadata/` stripped out.

The ZIP is the only published package: it is what the Chrome Web Store accepts, and stable Chrome refuses to install a `.crx` from outside the store anyway.

Every successful build on `main` also publishes a GitHub Release tagged with the version read from that extension's `manifest.json` — `v2.2.0` today. Bump `version` in the manifest and the next push cuts a new tag; rebuilding the same version replaces that release's assets instead of adding a duplicate.

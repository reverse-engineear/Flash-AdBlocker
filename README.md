# Flash AdBlocker (Chrome MV3)

A working Manifest V3 ad and tracker blocker upgraded from the original ShieldLite starter.

## What it blocks

- **214,029 bundled ad/tracker domains**, including **209,087 broad domains** and site-scoped path rules
- **7,040 static blocking rules** plus **1,354 exception rules** (all shipped as static rulesets)
- **13,588 generic cosmetic selectors** plus **15,663 site-specific selectors** for 7,536 domains
- **Up to 4,500 custom/supplemental domains** on top of the bundled list
- **Per-site allowlist** that disables both network blocking and cosmetic filtering for that site
- **YouTube player ads.** Pre-rolls, mid-rolls, and companion ads are stripped from the player response before YouTube can schedule them, including same-origin ad deliveries that a host block cannot stop.

The popup and toolbar badge show requests blocked on the current page (unpacked builds use `onRuleMatchedDebug`; other builds fall back to matched-rule diagnostics).

## Verified

Tested against [adblock.turtlecute.org](https://adblock.turtlecute.org/) on 2026-10-23 with this build loaded in Chrome:

- **98% score** — 130 of 132 checks blocked
- **128/128 host checks blocked** across ads, analytics, error trackers, social trackers, mix, and OEM categories
- Both cosmetic checks hidden (static and dynamically inserted ad slots)
- The two unblocked checks are first-party scripts served from the test page's own origin, which a network blocker cannot block; 98% is the extension ceiling on this test

Per-site allowlist, global pause/resume, popup counters, and the options page were also verified in an isolated Chrome profile.

YouTube was tested on 2026-10-23 with version 2.2.0 in Chrome:

- **Before the fix:** a 10-second Google Ads pre-roll played inside the player, a Sponsored card appeared in the sidebar, and ad playback telemetry used first-party paths (`api/stats/playback|atr|watchtime` with `el=adunit&adformat=15_2_1`), so network-only blocking could not stop it.
- **After the fix:** two fresh navigations (`8SsBwHD9xwc` and `dQw4w9WgXcQ`) played the actual video with no in-player ad and no Sponsored card. The content script reported stripping four ad markers and continued stripping them as YouTube refreshed ad data. No `el=adunit` or `adformat` requests were made; the only ad-related network entries were blocked requests to `doubleclick`, `googlesyndication`, and `pagead` paths.
- The extension status page reported version 2.2.0 with six MAIN-world YouTube script registrations.

## Install

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder (the folder containing `manifest.json`).
4. Pin **Flash AdBlocker** from the Extensions menu.
5. Open an HTTP/HTTPS page and open the popup.

After changing files in an unpacked install, press **Reload** on `chrome://extensions` (a page refresh is not enough for static rulesets), then reload any tabs that were already open so the new rules, YouTube script, and cosmetic styles apply.

## How it works

- **Domain grouping.** Broad `||domain^` filters are packed into `requestDomains` lists (up to 1,000 domains per rule). Chrome matches those lists against subdomains too, so 200,000+ domains fit in only 255 broad blocking rules and stay far below the 30,000 static-rule ceiling.
- **Static rules** (`rules/ads.json`, `rules/exceptions.json`) are declared in the manifest, so they load instantly at browser startup and survive service-worker suspension. Chrome evaluates them even while the service worker is asleep.
- **Site-scoped paths** (for example `||googlesyndication.com/pagead/`) and initiator-scoped filters stay as precise individual rules, so narrow exceptions do not weaken broad domain blocking.
- **Control rules** (site allowlist and custom domains) use dedicated dynamic rule ID ranges. The bundled dynamic ruleset is now empty, so changing controls is cheap.
- **Pausing protection** adds a high-priority global allow rule rather than unloading the rulesets.
- **Cosmetic filtering** is applied with `chrome.scripting.insertCSS`, which is not affected by page CSP. It runs on navigation and updates live when settings or the allowlist change.
- **YouTube ads** are removed at the player response. A MAIN-world script (`youtube/youtube-main.js`) runs at `document_start` and deletes `adPlacements`, `adSlots`, `playerAds`, and `adBreakHeartbeatParams` from the embedded player response, later `youtubei/v1/player` responses, and parsed JSON that carries them. This stops same-origin ad scheduling that host blocking cannot see. A conservative cosmetic fallback hides ad cards and overlays, and auto-presses a visible Skip button only while the player is in its `ad-showing` state. The script is registered dynamically, so the global toggle and per-site allowlist are respected (changes apply to the next YouTube page load).
- **Exception rules** and per-site allow rules are evaluated above blocking rules.

## Settings

- **Custom blocked domains**: one domain per line. Plain domains, `||domain^` filters, and hosts-file lines are accepted.
- **Supplemental filter list**: downloads a hosts list or `||domain^` list and adds only domains not already covered by the bundled rules. The download happens only when you press the button.
- **Cosmetic filtering**: can be switched off without disabling network blocking.

## Important limitations

- This is not a full uBlock Origin replacement. It implements one targeted MAIN-world script for YouTube, but no general scriptlet engine, HTML filtering, procedural cosmetic selectors (`:has-text`, `:xpath`, `:style`, `:remove`), or every Adblock Plus option.
- YouTube can change its player response format at any time. If ads return, check `chrome://extensions` for script errors and reload the extension.
- Some filters in EasyList/EasyPrivacy and AdGuard use unsupported syntax (redirects, CSP, removeparam, element hiding) and are skipped. Rules with more than 60 site scopes, unsupported options, or non-ASCII patterns are also skipped.
- Cosmetic selectors can occasionally hide a legitimate element; disable cosmetic filtering for troubleshooting.
- A network block rule can break a site. Use the per-site allowlist.
- Browser-internal pages, the Chrome Web Store, and other extensions cannot be modified.
- Bundled lists are a snapshot (`2026-10-22`). Supplemental downloads only add **new** domains; they do not replace the bundled rules.

## Files

- `manifest.json` — MV3 configuration, permissions, static ruleset declarations, icons
- `background.js` — rule installation, allowlist/custom rules, cosmetic injection, YouTube script registration, counters
- `youtube/youtube-main.js` — MAIN-world YouTube player-response ad stripping and skip fallback
- `rules/ads.json` — static blocking ruleset (scoped rules plus grouped broad-domain rules)
- `rules/exceptions.json` — static exception ruleset
- `rules/bundled-dynamic.json` — empty migration placeholder; bundled blocking now lives in static rules
- `rules/domains.txt` — bundled domains used to avoid duplicates during supplemental imports
- `rules/stats.json` — rule counts, covered-domain counts, and source dates
- `cosmetic/generic.css` — generic element-hiding rules
- `cosmetic/sites.json` — per-domain element-hiding rules
- `popup.html`, `popup.js`, `popup.css` — toolbar popup
- `options.html`, `options.js`, `options.css` — settings page

## Privacy

The extension does not collect telemetry or send browsing data anywhere. It downloads a filter list only when you explicitly press **Update filters** / **Download & update**, using the URL you configure.

## Filter sources and licence

Bundled rules are derived from:

- [EasyList](https://easylist.to/easylist/easylist.txt) and [EasyPrivacy](https://easylist.to/easylist/easyprivacy.txt), version 202610221725 — GPLv3
- [AdGuard DNS filter](https://github.com/AdguardTeam/AdguardSDNSFilter), fetched 2026-10-22
- [AdGuard Mobile Ads filter](https://github.com/AdguardTeam/AdguardFilters), fetched 2026-10-22
- [AdGuard Tracking Protection filter](https://github.com/AdguardTeam/AdguardFilters), fetched 2026-10-22
- [Peter Lowe's Ad and tracking server list](https://pgl.yoyo.org/adservers/), fetched 2026-10-22

Check each upstream project's licence and attribution requirements before redistributing this extension.

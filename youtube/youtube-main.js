(() => {
  "use strict";

  const AD_KEYS = ["adPlacements", "adSlots", "playerAds"];
  const MAX_DEPTH = 40;
  let pending = 0;
  let lastReport = 0;

  function prune(node, depth) {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return 0;
    let removed = 0;
    if (!Array.isArray(node)) {
      for (const key of AD_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
        if (node[key] === null || node[key] === undefined) continue;
        if (Array.isArray(node[key]) && node[key].length === 0) continue;
        delete node[key];
        removed++;
      }
      if (Object.prototype.hasOwnProperty.call(node, "adBreakHeartbeatParams")) {
        delete node.adBreakHeartbeatParams;
        removed++;
      }
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (value && typeof value === "object") removed += prune(value, depth + 1);
    }
    return removed;
  }

  function strip(node) {
    let removed = 0;
    try {
      removed = prune(node, 0);
    } catch (_) {}
    if (!removed) return;
    pending += removed;
    const now = Date.now();
    if (now - lastReport < 1000) return;
    lastReport = now;
    console.debug(`[Flash AdBlocker] Stripped ${pending} YouTube ad marker${pending === 1 ? "" : "s"}`);
    pending = 0;
  }

  // YouTube embeds the first player response in the page itself.
  let initialPlayerResponse;
  try {
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      enumerable: true,
      get() { return initialPlayerResponse; },
      set(value) {
        strip(value);
        initialPlayerResponse = value;
      }
    });
  } catch (_) {}

  // Later player responses arrive through fetch()/XHR and are parsed with JSON.parse.
  const nativeParse = JSON.parse;
  JSON.parse = function (text) {
    const value = nativeParse.apply(this, arguments);
    if (typeof text === "string" &&
        (text.includes('"adPlacements"') || text.includes('"adSlots"') || text.includes('"playerAds"'))) {
      strip(value);
    }
    return value;
  };

  const nativeJson = Response.prototype.json;
  Response.prototype.json = function () {
    const response = this;
    return nativeJson.call(this).then(value => {
      if (/\/youtubei\/v1\/player(?:[/?]|$)/.test(response.url || "")) strip(value);
      return value;
    });
  };

  let poll = 0;
  const pollTimer = setInterval(() => {
    try {
      if (window.ytInitialPlayerResponse) strip(window.ytInitialPlayerResponse);
    } catch (_) {}
    if (++poll >= 40) clearInterval(pollTimer);
  }, 500);

  const SKIP_SELECTOR = ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button";
  setInterval(() => {
    const player = document.getElementById("movie_player");
    if (!player || !player.classList.contains("ad-showing")) return;
    const button = player.querySelector(SKIP_SELECTOR);
    if (!button || button.disabled || !button.getClientRects().length) return;
    button.click();
  }, 1000);
})();

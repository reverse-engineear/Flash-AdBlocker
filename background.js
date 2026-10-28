const DEFAULTS = {
  enabled: true,
  cosmeticEnabled: true,
  allowlist: [],
  customDomains: [],
  importedDomains: [],
  filterUrl: "https://easylist.to/easylist/easylist.txt",
  lastFilterUpdate: null,
  bundledVersion: null,
  bundledReady: false
};

const KILL_RULE_ID = 1;
const ALLOW_ID_START = 2;
const ALLOW_ID_END = 499;
const USER_ID_START = 500;
const USER_ID_END = 4999;
const BUNDLE_ID_START = 5000;
const BUNDLE_ID_END = 29999;
const USER_DOMAIN_LIMIT = USER_ID_END - USER_ID_START + 1;
const ALLOWLIST_LIMIT = ALLOW_ID_END - ALLOW_ID_START + 1;

const hasRuleMatchedDebug = Boolean(chrome.declarativeNetRequest.onRuleMatchedDebug);

const YOUTUBE_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com"
];
const YOUTUBE_SCRIPT_PREFIX = "flash-youtube-";

async function syncYouTubeScripts() {
  try {
    const settings = await getSettings();
    const allowlist = new Set(settings.allowlist);
    const desired = [];
    YOUTUBE_HOSTS.forEach((host, index) => {
      if (!settings.enabled || allowlist.has(host)) return;
      desired.push({
        id: `${YOUTUBE_SCRIPT_PREFIX}${index}`,
        matches: [`*://${host}/*`],
        js: ["youtube/youtube-main.js"],
        runAt: "document_start",
        allFrames: true,
        world: "MAIN",
        persistAcrossSessions: true
      });
    });

    const registered = await chrome.scripting.getRegisteredContentScripts();
    const ours = registered.filter(script => script.id.startsWith(YOUTUBE_SCRIPT_PREFIX));
    const desiredIds = new Set(desired.map(script => script.id));
    const removeIds = ours.filter(script => !desiredIds.has(script.id)).map(script => script.id);
    if (removeIds.length) await chrome.scripting.unregisterContentScripts({ ids: removeIds });

    const existing = new Map(ours.map(script => [script.id, script]));
    const toAdd = [];
    const toUpdate = [];
    for (const script of desired) {
      const current = existing.get(script.id);
      if (!current) {
        toAdd.push(script);
        continue;
      }
      const unchanged =
        current.runAt === script.runAt &&
        current.allFrames === script.allFrames &&
        current.world === script.world &&
        current.persistAcrossSessions === script.persistAcrossSessions &&
        current.matches.join("\n") === script.matches.join("\n") &&
        current.js.join("\n") === script.js.join("\n");
      if (!unchanged) toUpdate.push(script);
    }
    if (toUpdate.length) await chrome.scripting.updateContentScripts(toUpdate);
    if (toAdd.length) await chrome.scripting.registerContentScripts(toAdd);
  } catch (error) {
    console.error("YouTube script sync failed:", error);
  }
}

let ruleChain = Promise.resolve();
function dynamicUpdate(operation) {
  const run = ruleChain.then(operation);
  ruleChain = run.catch(() => {});
  return run;
}

let statsPromise = null;
function getStats() {
  if (!statsPromise) {
    statsPromise = fetch(chrome.runtime.getURL("rules/stats.json")).then(response => response.json());
  }
  return statsPromise;
}

let bundledDomainsPromise = null;
function getBundledDomains() {
  if (!bundledDomainsPromise) {
    bundledDomainsPromise = fetch(chrome.runtime.getURL("rules/domains.txt"))
      .then(response => response.text())
      .then(text => new Set(text.split(/\r?\n/).filter(Boolean)))
      .catch(() => new Set());
  }
  return bundledDomainsPromise;
}

let siteMapPromise = null;
function getSiteMap() {
  if (!siteMapPromise) {
    siteMapPromise = fetch(chrome.runtime.getURL("cosmetic/sites.json"))
      .then(response => response.json())
      .catch(() => ({}));
  }
  return siteMapPromise;
}

function isValidDomain(value) {
  return typeof value === "string" &&
    value.length <= 253 &&
    /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value);
}

function isIpv4(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) &&
    value.split(".").every(part => Number(part) <= 255);
}

function normalizeHostname(input) {
  if (typeof input !== "string") return "";
  let host = input.trim().toLowerCase();
  if (!host) return "";
  host = host.replace(/^@@/, "").replace(/^\|{0,2}/, "");
  if (host.includes("://")) {
    try { host = new URL(host).hostname; } catch (_) { return ""; }
  }
  host = host.split(/[/?#^]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return "";
  if (host.split(".").some(part => !part)) return "";
  return host;
}

function normalizeBlockDomain(input) {
  const host = normalizeHostname(input);
  if (!host) return "";
  return isValidDomain(host) || isIpv4(host) ? host : "";
}

function parseDomainList(input) {
  const text = Array.isArray(input) ? input.join("\n") : String(input || "");
  const out = [];
  const seen = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/#.*$/, "").trim();
    if (!line || line.startsWith("!") || line.startsWith("[")) continue;
    if (line.startsWith("@@")) continue;
    const hostsMatch = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+(\S+)/i);
    if (hostsMatch) line = hostsMatch[1];
    for (const token of line.split(/[\s,;]+/)) {
      const domain = normalizeBlockDomain(token);
      if (!domain || seen.has(domain)) continue;
      seen.add(domain);
      out.push(domain);
      if (out.length >= USER_DOMAIN_LIMIT) return out;
    }
  }
  return out;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(null);
  return {
    ...DEFAULTS,
    ...stored,
    allowlist: Array.isArray(stored.allowlist) ? stored.allowlist.map(normalizeHostname).filter(Boolean) : [],
    customDomains: Array.isArray(stored.customDomains) ? stored.customDomains : [],
    importedDomains: Array.isArray(stored.importedDomains) ? stored.importedDomains : [],
    enabled: stored.enabled !== false,
    cosmeticEnabled: stored.cosmeticEnabled !== false
  };
}

async function initSettings() {
  const stored = await chrome.storage.local.get(null);
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (stored[key] === undefined) patch[key] = value;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  const legacyKeys = ["customRules", "externalRuleCount"].filter(key => stored[key] !== undefined);
  if (legacyKeys.length) await chrome.storage.local.remove(legacyKeys);
}

function userDomainList(settings) {
  const seen = new Set();
  const out = [];
  for (const raw of [...(settings.customDomains || []), ...(settings.importedDomains || [])]) {
    const domain = normalizeBlockDomain(raw);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (out.length >= USER_DOMAIN_LIMIT) break;
  }
  return out;
}

async function rebuildControlRulesNow() {
  const settings = await getSettings();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing
    .filter(rule => rule.id >= KILL_RULE_ID && rule.id <= USER_ID_END)
    .map(rule => rule.id);
  const addRules = [];

  if (!settings.enabled) {
    addRules.push({
      id: KILL_RULE_ID,
      priority: 999999,
      action: { type: "allow" },
      condition: { urlFilter: "*" }
    });
  } else {
    const allowlist = [...new Set(settings.allowlist)].slice(0, ALLOWLIST_LIMIT);
    let id = ALLOW_ID_START;
    for (const host of allowlist) {
      if (id > ALLOW_ID_END) break;
      addRules.push({
        id: id++,
        priority: 1000,
        action: { type: "allowAllRequests" },
        condition: {
          requestDomains: [host],
          resourceTypes: ["main_frame", "sub_frame"]
        }
      });
    }
    id = USER_ID_START;
    for (const domain of userDomainList(settings)) {
      if (id > USER_ID_END) break;
      addRules.push({
        id: id++,
        priority: 1,
        action: { type: "block" },
        condition: { urlFilter: `||${domain}^` }
      });
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

function rebuildControlRules() {
  return dynamicUpdate(async () => {
    await rebuildControlRulesNow();
    await syncYouTubeScripts();
  });
}

async function installBundledDynamicRules(force) {
  const stats = await getStats();
  const stored = await chrome.storage.local.get({ bundledVersion: null, bundledReady: false });
  if (!force && stored.bundledReady && stored.bundledVersion === stats.bundledVersion) return;

  await dynamicUpdate(async () => {
    try {
      const existing = await chrome.declarativeNetRequest.getDynamicRules();
      if (existing.length) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: existing.map(rule => rule.id)
        });
      }
      const response = await fetch(chrome.runtime.getURL("rules/bundled-dynamic.json"));
      const rules = await response.json();
      if (!Array.isArray(rules) || rules.length !== stats.dynamicBundled) {
        throw new Error("Bundled rule file is inconsistent with stats.");
      }
      for (let i = 0; i < rules.length; i += 5000) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          addRules: rules.slice(i, i + 5000)
        });
      }
      await chrome.storage.local.set({
        bundledVersion: stats.bundledVersion,
        bundledReady: true
      });
    } catch (error) {
      await chrome.storage.local.set({ bundledReady: false });
      throw error;
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  (async () => {
    await initSettings();
    try {
      await installBundledDynamicRules(true);
    } catch (error) {
      console.error("Bundled dynamic rules failed to install:", error);
    }
    try {
      await rebuildControlRules();
    } catch (error) {
      console.error("Control rules failed to install:", error);
    }
    await applyCosmeticToAllTabs();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  (async () => {
    try {
      await installBundledDynamicRules(false);
    } catch (error) {
      console.error("Bundled dynamic rules failed to install:", error);
    }
    try {
      await rebuildControlRules();
    } catch (error) {
      console.error("Control rules failed to install:", error);
    }
    await applyCosmeticToAllTabs();
  })();
});

// A reloaded unpacked extension does not always fire onInstalled/onStartup.
// Reconcile the bundled version whenever the worker boots so stale rules do not linger.
(async () => {
  await initSettings();
  try {
    await installBundledDynamicRules(false);
  } catch (error) {
    console.error("Bundled rule reconciliation failed:", error);
  }
  try {
    await rebuildControlRules();
  } catch (error) {
    console.error("Control rule reconciliation failed:", error);
  }
})();

// ----- request counters -----
const tabCounts = new Map();
const countsReady = chrome.storage.session
  .get({ tabCounts: {} })
  .then(({ tabCounts: stored }) => {
    for (const [key, value] of Object.entries(stored || {})) {
      const tabId = Number(key);
      if (Number.isInteger(tabId) && Number.isFinite(value)) tabCounts.set(tabId, value);
    }
  })
  .catch(() => {});

let flushTimer = null;
function scheduleCountsFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushCounts, 750);
}

async function flushCounts() {
  flushTimer = null;
  try {
    await countsReady;
    await chrome.storage.session.set({ tabCounts: Object.fromEntries(tabCounts) });
    for (const tabId of tabCounts.keys()) updateBadge(tabId);
  } catch (_) {}
}

function bumpCount(tabId) {
  countsReady.then(() => {
    tabCounts.set(tabId, (tabCounts.get(tabId) || 0) + 1);
    scheduleCountsFlush();
  });
}

async function resetTabCount(tabId) {
  await countsReady;
  if (tabCounts.delete(tabId)) {
    try { await chrome.storage.session.set({ tabCounts: Object.fromEntries(tabCounts) }); } catch (_) {}
  }
  updateBadge(tabId);
}

async function clearAllCounts() {
  await countsReady;
  const tabIds = [...tabCounts.keys()];
  tabCounts.clear();
  try { await chrome.storage.session.set({ tabCounts: {} }); } catch (_) {}
  for (const tabId of tabIds) updateBadge(tabId);
}

async function updateBadge(tabId) {
  const count = tabCounts.get(tabId) || 0;
  const text = count > 0 ? (count > 999 ? "999+" : String(count)) : "";
  try { await chrome.action.setBadgeText({ tabId, text }); } catch (_) {}
}

if (hasRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(info => {
    const tabId = info?.request?.tabId;
    if (!Number.isInteger(tabId) || tabId < 0) return;
    const rule = info.rule || {};
    const isBlockRule = rule.rulesetId === "ads" ||
      (rule.rulesetId === "_dynamic" && rule.ruleId >= USER_ID_START) ||
      rule.rulesetId === "_session";
    if (isBlockRule) bumpCount(tabId);
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url !== undefined) {
    resetTabCount(tabId);
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  countsReady.then(() => {
    tabCounts.delete(tabId);
    scheduleCountsFlush();
  });
});

try {
  chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
  chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
} catch (_) {}

// ----- cosmetic filtering -----
const cosmeticQueues = new Map();

function queueCosmetic(tabId, url, settings) {
  const previous = cosmeticQueues.get(tabId) || Promise.resolve();
  const next = previous
    .then(() => applyCosmeticToTab(tabId, url, settings))
    .catch(() => {});
  cosmeticQueues.set(tabId, next);
  next.finally(() => {
    if (cosmeticQueues.get(tabId) === next) cosmeticQueues.delete(tabId);
  });
  return next;
}

function getHostname(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase() : "";
  } catch (_) {
    return "";
  }
}

function buildSiteCss(siteMap, hostname) {
  const parts = hostname.split(".");
  const selectors = new Set();
  for (let i = 0; i < parts.length - 1; i++) {
    const domain = parts.slice(i).join(".");
    const list = siteMap[domain];
    if (Array.isArray(list)) {
      for (const selector of list) selectors.add(selector);
    }
  }
  const values = [...selectors];
  const chunks = [];
  for (let i = 0; i < values.length; i += 100) {
    chunks.push(values.slice(i, i + 100).join(",\n") + "{display:none!important}");
  }
  return chunks.join("\n");
}

async function applyCosmeticToTab(tabId, url, settingsOverride) {
  const settings = settingsOverride || await getSettings();
  const hostname = getHostname(url);
  if (!hostname) return;
  const siteMap = await getSiteMap();
  const siteCss = buildSiteCss(siteMap, hostname);
  const shouldApply = settings.enabled &&
    settings.cosmeticEnabled &&
    !settings.allowlist.includes(hostname);

  try {
    await chrome.scripting.removeCSS({
      target: { tabId, allFrames: true },
      files: ["cosmetic/generic.css"],
      origin: "USER"
    });
  } catch (_) {}
  if (siteCss) {
    try {
      await chrome.scripting.removeCSS({
        target: { tabId },
        css: siteCss,
        origin: "USER"
      });
    } catch (_) {}
  }
  if (!shouldApply) return;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ["cosmetic/generic.css"],
      origin: "USER"
    });
  } catch (_) {
    return;
  }
  if (siteCss) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        css: siteCss,
        origin: "USER"
      });
    } catch (_) {}
  }
}

async function applyCosmeticToAllTabs() {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({});
  const targets = tabs.filter(tab => tab.id && getHostname(tab.url || ""));
  await Promise.allSettled(targets.map(tab => queueCosmetic(tab.id, tab.url, settings)));
}

chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId !== 0) return;
  if (!getHostname(details.url)) return;
  queueCosmetic(details.tabId, details.url);
});

// ----- state and actions -----
async function getState(tabId) {
  const settings = await getSettings();
  const stats = await getStats();
  let hostname = "";
  let canControl = false;
  if (Number.isInteger(tabId)) {
    try {
      const tab = await chrome.tabs.get(tabId);
      hostname = getHostname(tab.url || "");
      canControl = Boolean(hostname);
    } catch (_) {}
  }

  let blockedCount = 0;
  if (settings.enabled) {
    await countsReady;
    blockedCount = tabCounts.get(tabId) || 0;
    if (!hasRuleMatchedDebug && Number.isInteger(tabId)) {
      try {
        const matched = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
        blockedCount = (matched.rulesMatchedInfo || []).filter(entry => {
          const rule = entry.rule || {};
          return rule.rulesetId === "ads" ||
            (rule.rulesetId === "_dynamic" && rule.ruleId >= USER_ID_START);
        }).length;
      } catch (_) {}
    }
  }

  const userDomains = new Set([...settings.customDomains, ...settings.importedDomains]);
  return {
    enabled: settings.enabled,
    cosmeticEnabled: settings.cosmeticEnabled,
    hostname,
    canControl,
    allowlisted: Boolean(hostname && settings.allowlist.includes(hostname)),
    blockedCount,
    filterCount: Number(stats.blockDomains || 0) + userDomains.size,
    bundledGenerated: stats.generated,
    lastFilterUpdate: settings.lastFilterUpdate,
    filterUrl: settings.filterUrl
  };
}

async function setEnabled(value) {
  const enabled = Boolean(value);
  await chrome.storage.local.set({ enabled });
  await rebuildControlRules();
  if (!enabled) await clearAllCounts();
  await applyCosmeticToAllTabs();
  return { ok: true, enabled };
}

async function setCosmetic(value) {
  const cosmeticEnabled = Boolean(value);
  await chrome.storage.local.set({ cosmeticEnabled });
  await applyCosmeticToAllTabs();
  return { ok: true, cosmeticEnabled };
}

async function toggleSite(rawHostname) {
  const hostname = normalizeHostname(rawHostname);
  if (!hostname) throw new Error("This page cannot be allowlisted.");
  const settings = await getSettings();
  const allowlist = new Set(settings.allowlist);
  const wasAllowlisted = allowlist.has(hostname);
  if (wasAllowlisted) {
    allowlist.delete(hostname);
  } else {
    if (allowlist.size >= ALLOWLIST_LIMIT) throw new Error("Allowlist is full.");
    allowlist.add(hostname);
  }
  await chrome.storage.local.set({ allowlist: [...allowlist] });
  await rebuildControlRules();
  await applyCosmeticToAllTabs();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id && getHostname(tab.url || "") === hostname) await resetTabCount(tab.id);
  }
  return { ok: true, allowlisted: !wasAllowlisted };
}

async function saveOptions(message) {
  const patch = {};
  if (typeof message.enabled === "boolean") {
    patch.enabled = message.enabled;
  }
  if (typeof message.cosmeticEnabled === "boolean") {
    patch.cosmeticEnabled = message.cosmeticEnabled;
  }
  if (message.filterUrl !== undefined) {
    const url = String(message.filterUrl || "").trim();
    if (!/^https:\/\/[^\s]+$/i.test(url)) throw new Error("Filter list must be an HTTPS URL.");
    patch.filterUrl = url;
  }
  let customCount;
  if (message.customDomains !== undefined) {
    patch.customDomains = parseDomainList(message.customDomains);
    customCount = patch.customDomains.length;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  await rebuildControlRules();
  if (patch.enabled === false) await clearAllCounts();
  await applyCosmeticToAllTabs();
  return { ok: true, customRuleCount: customCount };
}

async function updateFilters(overrideUrl) {
  const settings = await getSettings();
  const url = String(overrideUrl || settings.filterUrl || DEFAULTS.filterUrl).trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw new Error("Filter list must be an HTTPS URL.");
  const response = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`Filter download failed: HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 8_000_000) throw new Error("Filter list is too large (8 MB limit).");

  const bundled = await getBundledDomains();
  const customDomains = new Set(settings.customDomains);
  const available = Math.max(0, USER_DOMAIN_LIMIT - customDomains.size);
  const imported = new Set();
  let skippedBundled = 0;
  let skippedLimit = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("!") || line.startsWith("[") || line.startsWith("@@")) continue;
    let match = line.match(/^\|\|([a-z0-9.-]+\.[a-z]{2,})\^?$/i);
    if (!match) match = line.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9.-]+\.[a-z]{2,})$/i);
    if (!match) continue;
    const domain = match[1].toLowerCase();
    if (!isValidDomain(domain)) continue;
    if (bundled.has(domain)) { skippedBundled++; continue; }
    if (customDomains.has(domain) || imported.has(domain)) continue;
    if (imported.size >= available) { skippedLimit++; continue; }
    imported.add(domain);
  }

  const updatedAt = new Date().toISOString();
  await chrome.storage.local.set({
    importedDomains: [...imported],
    filterUrl: url,
    lastFilterUpdate: updatedAt
  });
  await rebuildControlRules();
  return {
    ok: true,
    count: imported.size,
    skippedBundled,
    skippedLimit,
    updatedAt
  };
}

async function getOptions() {
  const settings = await getSettings();
  const stats = await getStats();
  const domains = userDomainList(settings);
  return {
    ...settings,
    stats,
    customRuleCount: settings.customDomains.length,
    importedCount: settings.importedDomains.length,
    userRuleCount: domains.length,
    allowlistCount: settings.allowlist.length
  };
}

async function handleMessage(message) {
  switch (message?.type) {
    case "GET_STATE":
      return getState(Number.isInteger(message.tabId) ? message.tabId : null);
    case "SET_ENABLED":
      return setEnabled(message.value);
    case "SET_COSMETIC":
      return setCosmetic(message.value);
    case "TOGGLE_SITE":
      return toggleSite(message.hostname);
    case "SAVE_OPTIONS":
      return saveOptions(message);
    case "UPDATE_FILTERS":
      return updateFilters(message.url);
    case "GET_OPTIONS":
      return getOptions();
    default:
      return { ok: false, error: "Unknown request" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handleMessage(message)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

const $ = id => document.getElementById(id);
let activeTabId = null;
let state = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("enabledToggle").addEventListener("change", async event => {
    const result = await send({ type: "SET_ENABLED", value: event.target.checked });
    if (!result.ok) showMessage(result.error || "Could not change protection.");
    else showMessage(event.target.checked ? "Protection enabled." : "Protection paused.");
    await refresh();
  });
  $("cosmeticToggle").addEventListener("change", async event => {
    const result = await send({ type: "SET_COSMETIC", value: event.target.checked });
    showMessage(result.ok ? "Cosmetic filtering updated." : result.error);
    await refresh();
  });
  $("siteToggle").addEventListener("click", async () => {
    if (!state?.canControl) return showMessage("This page cannot be controlled.");
    const result = await send({ type: "TOGGLE_SITE", hostname: state.hostname });
    if (!result.ok) return showMessage(result.error || "Could not update this site.");
    showMessage(result.allowlisted
      ? "Ads allowed here. Reload the page to see the change."
      : "Protection restored here. Reload the page to see the change.");
    await refresh();
  });
  $("updateBtn").addEventListener("click", async () => {
    $("updateBtn").disabled = true;
    $("updateBtn").textContent = "Updating…";
    try {
      const result = await send({ type: "UPDATE_FILTERS" });
      if (!result.ok) {
        showMessage(result.error || "Filter update failed.");
      } else if (result.count > 0) {
        showMessage(`Added ${result.count.toLocaleString()} new rules. ${result.skippedBundled.toLocaleString()} domains were already bundled.`);
      } else {
        showMessage(`No new rules. ${result.skippedBundled.toLocaleString()} domains were already covered by the bundled list.`);
      }
      await refresh();
    } finally {
      $("updateBtn").disabled = false;
      $("updateBtn").textContent = "Update filters";
    }
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;

  chrome.storage.session.onChanged.addListener(changes => {
    if (!changes.tabCounts || activeTabId == null) return;
    const counts = changes.tabCounts.newValue || {};
    $("blockedCount").textContent = Number(counts[activeTabId] || 0).toLocaleString();
  });

  await refresh();
}

async function refresh() {
  state = await send({ type: "GET_STATE", tabId: activeTabId });
  if (!state || state.ok === false) {
    showMessage(state?.error || "Could not read extension state.");
    return;
  }
  const enabled = state.enabled;
  const allowed = state.allowlisted;
  $("enabledToggle").checked = enabled;
  $("cosmeticToggle").checked = state.cosmeticEnabled;
  $("statusTitle").textContent = !enabled
    ? "Protection paused"
    : allowed ? "Ads allowed here" : "Protection active";
  $("shieldIcon").textContent = !enabled ? "Ⅱ" : allowed ? "–" : "✓";
  $("siteText").textContent = state.hostname || "Unavailable on this page";
  $("blockedCount").textContent = Number(state.blockedCount || 0).toLocaleString();
  $("filterCount").textContent = Number(state.filterCount || 0).toLocaleString();
  $("siteToggle").textContent = allowed
    ? "Enable protection on this site"
    : "Allow ads on this site";
  $("siteToggle").disabled = !state.canControl;
  $("updateStatus").textContent = state.lastFilterUpdate
    ? `Extra filters: ${new Date(state.lastFilterUpdate).toLocaleDateString()}`
    : `Bundled rules: ${state.bundledGenerated || "unknown date"}`;
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function showMessage(text) {
  $("message").textContent = text || "";
}

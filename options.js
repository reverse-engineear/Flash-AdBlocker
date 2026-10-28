const $ = id => document.getElementById(id);
let current = null;

document.addEventListener("DOMContentLoaded", async () => {
  bind();
  await refreshOptions();
});

function bind() {
  $("saveBtn").addEventListener("click", save);
  $("updateBtn").addEventListener("click", update);
}

async function refreshOptions() {
  const data = await send({ type: "GET_OPTIONS" });
  if (!data || data.ok === false) {
    status(data?.error || "Could not load settings.");
    return;
  }
  current = data;
  $("enabled").checked = data.enabled !== false;
  $("cosmeticEnabled").checked = data.cosmeticEnabled !== false;
  $("filterUrl").value = data.filterUrl || "https://easylist.to/easylist/easylist.txt";
  $("customDomains").value = (data.customDomains || []).join("\n");
  renderStats(data);
}

function renderStats(data) {
  const stats = data.stats || {};
  const rows = [
    ["Bundled ad/tracker domains", stats.blockDomains],
    ["Bundled blocking rules", stats.staticAds],
    ["Exception rules", stats.staticExceptions],
    ["Imported filter rules", data.importedCount],
    ["Custom domain rules", data.customRuleCount],
    ["Allowlisted sites", data.allowlistCount],
    ["Cosmetic selectors", stats.cosmeticSelectors]
  ];
  $("stats").innerHTML = rows.map(([label, value]) =>
    `<div class="stat-row"><span>${label}</span><strong>${Number(value || 0).toLocaleString()}</strong></div>`
  ).join("") +
  `<div class="stat-row note"><span>Bundled list from</span><strong>${escapeHtml(stats.generated || "unknown")}</strong></div>` +
  `<div class="stat-row note"><span>Sources</span><strong>${escapeHtml((stats.sources || []).join(", "))}</strong></div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

async function save() {
  $("saveBtn").disabled = true;
  const data = await send({
    type: "SAVE_OPTIONS",
    enabled: $("enabled").checked,
    cosmeticEnabled: $("cosmeticEnabled").checked,
    filterUrl: $("filterUrl").value.trim(),
    customDomains: $("customDomains").value
  });
  $("saveBtn").disabled = false;
  if (!data.ok) return status(data.error || "Could not save settings.");
  status("Settings saved.");
  await refreshOptions();
}

async function update() {
  const url = $("filterUrl").value.trim();
  if (!/^https:\/\/\S+$/i.test(url)) return status("Please enter a valid HTTPS URL.");
  $("updateBtn").disabled = true;
  $("updateBtn").textContent = "Downloading…";
  status("Downloading filter list…");
  try {
    const data = await send({ type: "UPDATE_FILTERS", url });
    if (!data.ok) {
      status(data.error || "Filter update failed.");
    } else if (data.count > 0) {
      status(`Added ${data.count.toLocaleString()} new rules. ${data.skippedBundled.toLocaleString()} domains were already bundled.`);
    } else {
      status(`No new rules. ${data.skippedBundled.toLocaleString()} domains were already covered by the bundled list.`);
    }
    if (data.skippedLimit > 0) {
      status(`${$("status").textContent} ${data.skippedLimit.toLocaleString()} domains were skipped at the import limit.`);
    }
    await refreshOptions();
  } finally {
    $("updateBtn").disabled = false;
    $("updateBtn").textContent = "Download & update";
  }
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function status(text) {
  $("status").textContent = text || "";
}

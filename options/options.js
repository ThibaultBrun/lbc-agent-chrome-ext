// Options page — load/save settings, probe backends, clear cache.

const FIELDS = [
  "llmMode", "ollamaUrl", "ollamaExtractModel", "ollamaSynthModel",
  "fetchPages", "enableLbcComparables", "enableTrocVeloComparables", "maxWebResults",
];

function setVal(id, v) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === "checkbox") el.checked = !!v;
  else el.value = v ?? "";
}
function getVal(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number") return parseInt(el.value, 10) || 0;
  return el.value;
}

function load() {
  chrome.runtime.sendMessage({ type: "get_settings" }, (s) => {
    for (const f of FIELDS) setVal(f, s[f]);
  });
}

function save() {
  const patch = {};
  for (const f of FIELDS) patch[f] = getVal(f);
  chrome.runtime.sendMessage({ type: "save_settings", patch }, () => {
    const status = document.getElementById("save-status");
    status.textContent = "✓ Enregistré";
    setTimeout(() => (status.textContent = ""), 2000);
  });
}

function probe() {
  const out = document.getElementById("probe-output");
  out.textContent = "Test en cours…";
  chrome.runtime.sendMessage({ type: "probe_backends" }, (r) => {
    if (!r) { out.textContent = "Pas de réponse du background."; return; }
    const lines = [];
    lines.push(`Backend sélectionné : ${r.backend?.kind || "—"}`);
    lines.push(`Ollama dispo : ${r.ollama.available ? "oui" : "non"}`);
    if (r.ollama.available) lines.push(`Modèles : ${r.ollama.models.join(", ") || "(aucun)"}`);
    out.textContent = lines.join("\n");
  });
}

function clearCache() {
  const status = document.getElementById("cache-status");
  status.textContent = "…";
  chrome.runtime.sendMessage({ type: "cache_clear" }, () => {
    status.textContent = "✓ Cache vidé";
    setTimeout(() => (status.textContent = ""), 2000);
  });
}

document.getElementById("btn-save").addEventListener("click", save);
document.getElementById("btn-probe").addEventListener("click", probe);
document.getElementById("btn-clear-cache").addEventListener("click", clearCache);
load();

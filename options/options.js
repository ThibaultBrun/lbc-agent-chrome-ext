// Options page — load/save settings, probe backends, clear cache.
// On lit/écrit directement chrome.storage.local pour éviter les soucis
// de sleep du service worker (le bg peut renvoyer null sur get_settings
// si la promesse est rejetée par un timeout interne du channel).
import { WEBLLM_MODELS, DEFAULT_SETTINGS } from "../lib/core/config.js";

const FIELDS = [
  "llmMode", "ollamaUrl", "ollamaExtractModel", "ollamaSynthModel", "webllmModel",
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

function fillWebllmModels() {
  const sel = document.getElementById("webllmModel");
  for (const m of WEBLLM_MODELS) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
}

function load() {
  chrome.storage.local.get(["settings"], (items) => {
    const s = { ...DEFAULT_SETTINGS, ...(items?.settings || {}) };
    for (const f of FIELDS) setVal(f, s[f]);
  });
}

function save() {
  chrome.storage.local.get(["settings"], (items) => {
    const current = { ...DEFAULT_SETTINGS, ...(items?.settings || {}) };
    const next = { ...current };
    for (const f of FIELDS) next[f] = getVal(f);
    chrome.storage.local.set({ settings: next }, () => {
      const status = document.getElementById("save-status");
      status.textContent = "✓ Enregistré";
      setTimeout(() => (status.textContent = ""), 2000);
    });
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
    if (r.ollama.available) lines.push(`  Modèles : ${r.ollama.models.join(", ") || "(aucun)"}`);
    lines.push(`WebLLM dispo : ${r.webllm?.available ? "oui" : "non"}${r.webllm?.reason ? ` (${r.webllm.reason})` : ""}`);
    lines.push(`Gemini Nano : ${r.nano?.available ? "oui" : "non"}`);
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

fillWebllmModels();
document.getElementById("btn-save").addEventListener("click", save);
document.getElementById("btn-probe").addEventListener("click", probe);
document.getElementById("btn-clear-cache").addEventListener("click", clearCache);
load();

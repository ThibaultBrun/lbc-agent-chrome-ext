// Adaptateur LLM unifié : Gemini Nano (LanguageModel) + Ollama local autodétecté.
// Le service worker n'a PAS accès à `LanguageModel` — c'est un objet de fenêtre.
// Donc tout appel Nano doit être fait depuis le content script ou le popup.
// Ollama tourne sur localhost et est appelé en HTTP (donc OK depuis service worker).

import { DEFAULT_SETTINGS } from "./config.js";

let _settingsCache = null;

export async function getSettings() {
  if (_settingsCache) return _settingsCache;
  if (!chrome?.storage?.local) return DEFAULT_SETTINGS;
  return new Promise((resolve) => {
    chrome.storage.local.get(["settings"], (items) => {
      _settingsCache = { ...DEFAULT_SETTINGS, ...(items.settings || {}) };
      resolve(_settingsCache);
    });
  });
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  _settingsCache = next;
  return new Promise((resolve) => chrome.storage.local.set({ settings: next }, () => resolve(next)));
}

// ─── Détection des backends ─────────────────────────────────────────────

export async function probeOllama(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${url}/api/tags`, { signal: ctrl.signal, credentials: "omit" });
    clearTimeout(t);
    if (!res.ok) return { available: false, models: [] };
    const data = await res.json();
    return { available: true, models: (data.models || []).map((m) => m.name) };
  } catch {
    return { available: false, models: [] };
  }
}

// Côté page (content script ou popup), `self.LanguageModel` est exposé.
export function probeNano() {
  if (typeof self === "undefined" || !("LanguageModel" in self)) {
    return { available: false, status: "missing" };
  }
  return { available: true, status: "exposed" };
}

// WebGPU est dispo dans l'offscreen document (contexte fenêtre).
// Depuis le service worker on ne peut pas le tester directement → on délègue.
export async function probeWebllm() {
  // Demande à l'offscreen d'évaluer WebGPU + cache modèle.
  if (typeof chrome === "undefined" || !chrome.offscreen) return { available: false, reason: "no_offscreen" };
  try {
    if (!(await chrome.offscreen.hasDocument?.())) {
      await chrome.offscreen.createDocument({
        url: "offscreen/offscreen.html",
        reasons: ["DOM_PARSER"],
        justification: "Run WebLLM (WebGPU) and Gemini Nano",
      });
    }
  } catch { /* may already exist */ }
  return new Promise((resolve) => {
    const requestId = `probe_${Date.now()}`;
    const onMessage = (msg) => {
      if (msg?.type === "webllm:probe_done" && msg.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(onMessage);
        resolve(msg.result);
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.runtime.sendMessage({ type: "webllm:probe", requestId });
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(onMessage);
      resolve({ available: false, reason: "timeout" });
    }, 5000);
  });
}

// ─── Appels Ollama (depuis service worker) ──────────────────────────────

export async function ollamaChat({
  url,
  model,
  messages,
  format = null,
  temperature = 0,
  timeout = 60000,
  signal,
}) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener("abort", onAbort);
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const body = {
      model,
      messages,
      stream: false,
      options: { temperature },
    };
    if (format) body.format = format;
    const res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      credentials: "omit",
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return data?.message?.content ?? "";
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

// Streaming Ollama → callback par chunk.
export async function ollamaChatStream({ url, model, messages, temperature = 0.2, onChunk, signal }) {
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true, options: { temperature } }),
    signal,
    credentials: "omit",
  });
  if (!res.ok || !res.body) throw new Error(`Ollama stream HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const piece = obj?.message?.content || "";
        if (piece) {
          full += piece;
          onChunk?.(piece);
        }
      } catch { /* ignore JSON partiel */ }
    }
  }
  return full;
}

// ─── Backend selection (heuristique « auto ») ───────────────────────────

export async function selectBackend(settings) {
  const s = settings || (await getSettings());
  if (s.llmMode === "nano") return { kind: "nano" };
  if (s.llmMode === "ollama") {
    const probe = await probeOllama(s.ollamaUrl);
    if (!probe.available) return { kind: "none", reason: "ollama_unreachable" };
    return { kind: "ollama", url: s.ollamaUrl, models: probe.models };
  }
  if (s.llmMode === "webllm") {
    const probe = await probeWebllm();
    if (!probe.available) return { kind: "none", reason: probe.reason || "webllm_unavailable" };
    return { kind: "webllm", model: s.webllmModel || "Llama-3.1-8B-Instruct-q4f32_1-MLC" };
  }
  // auto : Ollama (qualité max) > WebLLM (zéro install) > Nano (fallback simple)
  const ollama = await probeOllama(s.ollamaUrl);
  if (ollama.available) return { kind: "ollama", url: s.ollamaUrl, models: ollama.models };
  const webllm = await probeWebllm();
  if (webllm.available) return { kind: "webllm", model: s.webllmModel || "Llama-3.1-8B-Instruct-q4f32_1-MLC", cached: webllm.cached };
  if (typeof self !== "undefined" && "LanguageModel" in self) return { kind: "nano" };
  return { kind: "none", reason: "no_backend" };
}

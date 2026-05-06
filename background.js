// Service worker — routeur de messages + orchestration du pipeline.
// Gemini Nano n'est pas exposé dans le service worker MV3 ; on délègue les appels
// Nano à un offscreen document (chrome.offscreen API).

import { enrichAd, LlmRouter } from "./lib/pipeline.js";
import { getSettings, saveSettings, probeOllama, selectBackend } from "./lib/llm.js";
import { cacheClear } from "./lib/utils.js";

let creatingOffscreen = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  if (creatingOffscreen) { await creatingOffscreen; return; }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: ["DOM_PARSER"],
    justification: "Run Gemini Nano LanguageModel which is only available in window contexts.",
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

// Bridge Nano via offscreen document
async function nanoBridge({ system, prompt, schema, stream, onChunk }) {
  await ensureOffscreen();
  const requestId = `nano_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const onMessage = (msg) => {
      if (msg?.type === "nano:chunk" && msg.requestId === requestId) {
        onChunk?.(msg.delta);
        return;
      }
      if (msg?.type === "nano:done" && msg.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(onMessage);
        resolve(msg.text);
      } else if (msg?.type === "nano:error" && msg.requestId === requestId) {
        chrome.runtime.onMessage.removeListener(onMessage);
        reject(new Error(msg.error));
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.runtime.sendMessage({
      type: "nano:request",
      requestId,
      system,
      prompt,
      schema,
      stream: !!stream,
    });
  });
}

// Connexion bidirectionnelle pour le streaming des phases pipeline
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "bike-analyze") return;
  let aborted = false;
  port.onDisconnect.addListener(() => { aborted = true; });

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "analyze") return;
    try {
      const settings = await getSettings();
      const backend = await selectBackend(settings);
      port.postMessage({ type: "backend", backend });
      const llm = new LlmRouter({ backend, nanoBridge });
      const emit = (ev) => { if (!aborted) port.postMessage(ev); };
      await enrichAd({ ad: msg.ad, llm, settings, emit });
    } catch (e) {
      port.postMessage({ type: "error", error: e.message });
    } finally {
      try { port.disconnect(); } catch {}
    }
  });
});

// Messages one-shot (settings, probe, cache)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "get_settings") {
    getSettings().then(sendResponse);
    return true;
  }
  if (msg?.type === "save_settings") {
    saveSettings(msg.patch).then(sendResponse);
    return true;
  }
  if (msg?.type === "probe_backends") {
    (async () => {
      const settings = await getSettings();
      const ollama = await probeOllama(settings.ollamaUrl);
      const backend = await selectBackend(settings);
      sendResponse({ ollama, backend });
    })();
    return true;
  }
  if (msg?.type === "cache_clear") {
    cacheClear().then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[LBC Bike Analyzer] installed");
});

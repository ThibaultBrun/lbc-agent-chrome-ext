// Service worker — routeur de messages + orchestration du pipeline.
// Gemini Nano et WebLLM ne tournent pas dans le service worker MV3 ; on délègue
// les appels à un offscreen document (chrome.offscreen API).

import { enrichAd } from "./lib/core/pipeline.js";
import { LlmRouter } from "./lib/core/llm-router.js";
import { getSettings, saveSettings, probeOllama, probeWebllm, selectBackend } from "./lib/core/llm.js";
import { cacheClear } from "./lib/core/utils.js";

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

// Bridge générique vers offscreen — utilisé pour Nano ET WebLLM.
// `kind` = "nano" | "webllm". Les events sont préfixés en conséquence.
function offscreenBridge(kind) {
  return async function bridge({ system, prompt, schema, stream, onChunk, model, onProgress }) {
    await ensureOffscreen();
    const requestId = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const onMessage = (msg) => {
        if (!msg || msg.requestId !== requestId) return;
        if (msg.type === `${kind}:chunk`) { onChunk?.(msg.delta); return; }
        if (msg.type === `${kind}:progress`) { onProgress?.(msg); return; }
        if (msg.type === `${kind}:done`) {
          chrome.runtime.onMessage.removeListener(onMessage);
          resolve(msg.text);
        } else if (msg.type === `${kind}:error`) {
          chrome.runtime.onMessage.removeListener(onMessage);
          reject(new Error(msg.error));
        }
      };
      chrome.runtime.onMessage.addListener(onMessage);
      chrome.runtime.sendMessage({
        type: `${kind}:request`,
        requestId,
        system,
        prompt,
        schema,
        stream: !!stream,
        model,
      });
    });
  };
}

const nanoBridge = offscreenBridge("nano");
const webllmBridge = offscreenBridge("webllm");

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
      const emit = (ev) => { if (!aborted) port.postMessage(ev); };
      const onProgress = (m) => emit({ type: "model_progress", backend: backend.kind, text: m.text, progress: m.progress, loaded: m.loaded });
      const llm = new LlmRouter({ backend, nanoBridge, webllmBridge, onProgress });
      await enrichAd({ ad: msg.ad, llm, settings, emit });
    } catch (e) {
      port.postMessage({ type: "error", error: e.message });
    } finally {
      try { port.disconnect(); } catch {}
    }
  });
});

// Liste blanche des types que le BG traite (les autres types — internes
// nano:*/webllm:* — sont ignores par ce listener).
const HANDLED_TYPES = new Set([
  "get_settings", "save_settings", "probe_backends", "cache_clear", "open_options",
]);

// Messages one-shot (settings, probe, cache)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.type || !HANDLED_TYPES.has(msg.type)) return false; // ignore silencieusement
  if (msg.type === "get_settings") {
    getSettings().then(sendResponse);
    return true;
  }
  if (msg.type === "save_settings") {
    saveSettings(msg.patch).then(sendResponse);
    return true;
  }
  if (msg.type === "probe_backends") {
    (async () => {
      const settings = await getSettings();
      const ollama = await probeOllama(settings.ollamaUrl);
      const webllm = await probeWebllm();
      // Le service worker n'a pas LanguageModel : on fait un probe via offscreen.
      let nano = { available: false };
      try {
        await ensureOffscreen();
        nano = await new Promise((resolve) => {
          const id = `nanoprobe_${Date.now()}`;
          const onMsg = (m) => {
            if (m?.type === "nano:probe_done" && m.requestId === id) {
              chrome.runtime.onMessage.removeListener(onMsg);
              resolve(m.result);
            }
          };
          chrome.runtime.onMessage.addListener(onMsg);
          chrome.runtime.sendMessage({ type: "nano:probe", requestId: id });
          setTimeout(() => { chrome.runtime.onMessage.removeListener(onMsg); resolve({ available: false, reason: "timeout" }); }, 3000);
        });
      } catch { /* ignore */ }
      const backend = await selectBackend(settings);
      sendResponse({ ollama, webllm, nano, backend });
    })();
    return true;
  }
  if (msg.type === "cache_clear") {
    cacheClear().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "open_options") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[LBC Bike Analyzer] installed");
});

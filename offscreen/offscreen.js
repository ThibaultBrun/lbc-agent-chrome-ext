// Offscreen document — héberge les backends qui ne marchent pas dans un service worker :
// 1) Gemini Nano (`LanguageModel`) — exposé en contexte fenêtre uniquement
// 2) WebLLM (WebGPU) — WebGPU est dispo dans les contextes fenêtre

let webllmEngine = null;
let webllmCurrentModel = null;
let webllmModulePromise = null;

async function loadWebllm() {
  if (!webllmModulePromise) {
    webllmModulePromise = import(chrome.runtime.getURL("dist/webllm.bundle.js"));
  }
  return webllmModulePromise;
}

async function probeWebllm() {
  // 1. WebGPU dispo ?
  if (typeof navigator === "undefined" || !navigator.gpu) {
    return { available: false, reason: "no_webgpu" };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { available: false, reason: "no_adapter" };
  } catch (e) {
    return { available: false, reason: "adapter_error", error: String(e?.message || e) };
  }
  // 2. Module WebLLM importable ?
  try {
    const m = await loadWebllm();
    return {
      available: true,
      cached: false, // hasModelInCache nécessiterait un model_id ; on laisse au flow d'init
      hasHelper: typeof m.hasModelInCache === "function",
    };
  } catch (e) {
    return { available: false, reason: "module_load_failed", error: String(e?.message || e) };
  }
}

async function ensureWebllmEngine(modelId, requestId) {
  if (webllmEngine && webllmCurrentModel === modelId) return webllmEngine;
  const m = await loadWebllm();
  // Si on change de modèle, on jette l'ancien
  if (webllmEngine && webllmCurrentModel !== modelId) {
    try { await webllmEngine.unload?.(); } catch { /* ignore */ }
    webllmEngine = null;
  }
  webllmEngine = await m.CreateMLCEngine(modelId, {
    initProgressCallback: (p) => {
      chrome.runtime.sendMessage({
        type: "webllm:progress",
        requestId,
        text: p.text,
        progress: p.progress,
      });
    },
  });
  webllmCurrentModel = modelId;
  return webllmEngine;
}

function safeSchemaForWebllm(schema) {
  // WebLLM/MLC accepte response_format = { type: "json_object" } ou
  // { type: "grammar", grammar: "..." }. Pour rester simple et stable, on demande
  // json_object et on parse côté client. Le schema sert juste à renforcer le prompt.
  return { type: "json_object" };
}

async function webllmChat({ requestId, model, system, prompt, schema, stream }) {
  const engine = await ensureWebllmEngine(model, requestId);
  const messages = [
    { role: "system", content: system || "Tu es un assistant utile." },
    { role: "user", content: schema ? `${prompt}\n\nReponds UNIQUEMENT en JSON strict valide, sans markdown.` : prompt },
  ];
  const baseRequest = {
    messages,
    temperature: schema ? 0 : 0.2,
    max_tokens: 2000,
  };
  if (schema) baseRequest.response_format = safeSchemaForWebllm(schema);

  if (stream) {
    let full = "";
    const it = await engine.chat.completions.create({ ...baseRequest, stream: true });
    for await (const chunk of it) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) {
        full += delta;
        chrome.runtime.sendMessage({ type: "webllm:chunk", requestId, delta });
      }
    }
    return full;
  }
  const out = await engine.chat.completions.create(baseRequest);
  return out.choices?.[0]?.message?.content || "";
}

// ─── Gemini Nano ───────────────────────────────────────────────────────

let nanoSession = null;

// Émet un event progress homogène (text + progress 0..1) pour tous les paths Nano.
function emitNanoProgress(requestId, e) {
  // L'event LanguageModel `downloadprogress` expose .loaded (0..1), parfois aussi .total.
  const loaded = typeof e?.loaded === "number" ? e.loaded : 0;
  const pct = (loaded * 100).toFixed(1);
  chrome.runtime.sendMessage({
    type: "nano:progress",
    requestId,
    loaded,
    progress: loaded,
    text: `Téléchargement Gemini Nano · ${pct}%`,
  });
}

// Crée une session Nano avec progress propagé via le requestId courant.
// Le message de progress n'est envoyé QUE si le modèle est réellement en cours
// de download (availability=downloading/downloadable). Si available, silence total.
async function createNanoSession({ system, requestId }) {
  if (!("LanguageModel" in self)) throw new Error("LanguageModel API non disponible. Activez chrome://flags/#prompt-api-for-gemini-nano.");
  const availability = await self.LanguageModel.availability();
  if (availability === "unavailable") throw new Error("Gemini Nano non disponible sur cet appareil");
  const needsDownload = availability === "downloading" || availability === "downloadable";
  // On ne câble le monitor downloadprogress que si on doit vraiment télécharger.
  // Sinon, créer la session sans monitor (zéro message envoyé).
  const opts = {
    initialPrompts: [{ role: "system", content: system || "Tu es un assistant utile." }],
    expectedInputs: [{ type: "text", languages: ["fr", "en"] }],
    expectedOutputs: [{ type: "text", languages: ["fr"] }],
  };
  if (needsDownload) {
    chrome.runtime.sendMessage({
      type: "nano:progress",
      requestId,
      progress: 0,
      text: "Téléchargement Gemini Nano · démarrage…",
    });
    opts.monitor = (m) => {
      m.addEventListener("downloadprogress", (e) => emitNanoProgress(requestId, e));
    };
  }
  return self.LanguageModel.create(opts);
}

async function nanoChat({ requestId, prompt, system, schema, stream }) {
  if (schema) {
    // Path JSON strict : on crée une session dédiée avec progress câblé dessus aussi.
    const session = await createNanoSession({ system: system || "Tu es un extracteur. Tu reponds en JSON strict.", requestId });
    try {
      return await session.prompt(prompt, { responseConstraint: schema });
    } finally {
      session.destroy?.();
    }
  }
  // Path texte / streaming : session partagée pour réutiliser le download.
  if (!nanoSession) nanoSession = await createNanoSession({ system, requestId });
  if (stream) {
    let full = "";
    const s = nanoSession.promptStreaming(prompt);
    for await (const chunk of s) {
      full += chunk;
      chrome.runtime.sendMessage({ type: "nano:chunk", requestId, delta: chunk });
    }
    return full;
  }
  return nanoSession.prompt(prompt);
}

// ─── Routeur ────────────────────────────────────────────────────────────

const OFFSCREEN_HANDLED = new Set(["webllm:probe", "webllm:request", "nano:probe", "nano:request"]);

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg?.type || !OFFSCREEN_HANDLED.has(msg.type)) return false;
  // On ne retourne pas la promise — Chrome ne doit pas attendre de réponse
  // (les résultats sont envoyés via runtime.sendMessage avec requestId).
  handleMessage(msg);
  return false;
});

async function handleMessage(msg) {
  if (msg.type === "webllm:probe") {
    const result = await probeWebllm();
    chrome.runtime.sendMessage({ type: "webllm:probe_done", requestId: msg.requestId, result });
    return;
  }
  if (msg.type === "nano:probe") {
    let result = { available: false };
    try {
      if ("LanguageModel" in self) {
        const av = await self.LanguageModel.availability();
        result = { available: av !== "unavailable", availability: av };
      } else {
        result = { available: false, reason: "no_LanguageModel_api" };
      }
    } catch (e) {
      result = { available: false, error: String(e?.message || e) };
    }
    chrome.runtime.sendMessage({ type: "nano:probe_done", requestId: msg.requestId, result });
    return;
  }
  if (msg.type === "webllm:request") {
    try {
      const text = await webllmChat(msg);
      chrome.runtime.sendMessage({ type: "webllm:done", requestId: msg.requestId, text });
    } catch (e) {
      chrome.runtime.sendMessage({ type: "webllm:error", requestId: msg.requestId, error: String(e?.message || e) });
    }
    return;
  }
  if (msg.type === "nano:request") {
    try {
      const text = await nanoChat(msg);
      chrome.runtime.sendMessage({ type: "nano:done", requestId: msg.requestId, text });
    } catch (e) {
      chrome.runtime.sendMessage({ type: "nano:error", requestId: msg.requestId, error: String(e?.message || e) });
    }
    return;
  }
}

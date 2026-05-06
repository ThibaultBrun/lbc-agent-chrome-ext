// Offscreen document — exécute les appels Gemini Nano (`LanguageModel`),
// que le service worker ne peut pas faire car cette API n'est exposée
// que dans des contextes fenêtre.

let cachedSession = null;

async function getSession(systemPrompt) {
  if (!("LanguageModel" in self)) throw new Error("LanguageModel API non disponible. Activez chrome://flags/#prompt-api-for-gemini-nano et téléchargez Gemini Nano via chrome://components.");
  const availability = await self.LanguageModel.availability();
  if (availability === "unavailable") throw new Error("Gemini Nano non disponible sur cet appareil");
  if (cachedSession) return cachedSession;
  cachedSession = await self.LanguageModel.create({
    initialPrompts: [{ role: "system", content: systemPrompt || "Tu es un assistant utile." }],
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        chrome.runtime.sendMessage({ type: "nano:progress", loaded: e.loaded });
      });
    },
  });
  return cachedSession;
}

chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type !== "nano:request") return;
  const { requestId, prompt, system, schema, stream } = msg;
  try {
    // Une session par appel pour les requêtes JSON-typées (schema), sinon partage
    if (schema) {
      const session = await self.LanguageModel.create({
        initialPrompts: [{ role: "system", content: system || "Tu es un extracteur. Tu reponds en JSON strict." }],
      });
      const text = await session.prompt(prompt, { responseConstraint: schema });
      session.destroy?.();
      chrome.runtime.sendMessage({ type: "nano:done", requestId, text });
      return;
    }

    const session = await getSession(system);
    if (stream) {
      let full = "";
      const s = session.promptStreaming(prompt);
      for await (const chunk of s) {
        full += chunk;
        chrome.runtime.sendMessage({ type: "nano:chunk", requestId, delta: chunk });
      }
      chrome.runtime.sendMessage({ type: "nano:done", requestId, text: full });
    } else {
      const text = await session.prompt(prompt);
      chrome.runtime.sendMessage({ type: "nano:done", requestId, text });
    }
  } catch (e) {
    chrome.runtime.sendMessage({ type: "nano:error", requestId, error: String(e?.message || e) });
  }
});

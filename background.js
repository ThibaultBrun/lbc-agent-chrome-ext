// Service worker: relais entre popup et content script.
// L'API Prompt (LanguageModel) est appelée depuis le popup (contexte fenêtre),
// car les service workers ne supportent pas toujours l'API embarquée.

chrome.runtime.onInstalled.addListener(() => {
  console.log('[LBC Analyzer] Extension installée.');
});

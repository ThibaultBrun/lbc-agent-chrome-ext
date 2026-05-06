// Popup minimal — diagnostic + accès rapide aux Options.

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setText(id, t) { const e = document.getElementById(id); if (e) e.textContent = t; }

async function init() {
  const tab = await getActiveTab();
  const status = document.getElementById("status");
  const actions = document.getElementById("actions");
  const onLbc = tab?.url?.includes("leboncoin.fr/ad/");
  if (!onLbc) {
    status.textContent = "Ouvrez une annonce vélo Leboncoin pour démarrer l'analyse.";
  } else {
    status.textContent = "Annonce Leboncoin détectée. L'overlay s'injecte automatiquement.";
    actions.classList.remove("hidden");
    document.getElementById("btn-analyze").addEventListener("click", () => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const host = document.getElementById("lbc-bike-analyzer-host");
          if (host) host.remove();
          // Rejoue l'init
          window.__lbcBikeOverlayLoaded = false;
          const s = document.createElement("script");
          s.textContent = "(function(){})();"; // no-op : reload via runtime
          document.head.appendChild(s);
          location.reload();
        },
      });
    });
  }
  document.getElementById("btn-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  chrome.runtime.sendMessage({ type: "probe_backends" }, (r) => {
    if (!r) return;
    setText("diag-backend", r.backend?.kind || "—");
    setText("diag-ollama", r.ollama.available ? "oui" : "non");
    setText("diag-models", r.ollama.models.length ? r.ollama.models.slice(0, 4).join(", ") : "—");
  });
}

init();

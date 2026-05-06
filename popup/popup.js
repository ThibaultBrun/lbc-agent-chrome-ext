// Popup: orchestration extraction + analyse via API Prompt embarquée Chrome.
// L'API exposée est `LanguageModel` (chrome://flags "Prompt API for Gemini Nano").

const $ = (id) => document.getElementById(id);

const ui = {
  status: $('model-status'),
  adInfo: $('ad-info'),
  adTitle: $('ad-title'),
  adPrice: $('ad-price'),
  adLocation: $('ad-location'),
  btnExtract: $('btn-extract'),
  btnAnalyze: $('btn-analyze'),
  result: $('result'),
  resultText: $('result-text'),
  error: $('error'),
};

let currentAd = null;

function showError(msg) {
  ui.error.textContent = msg;
  ui.error.classList.remove('hidden');
}
function clearError() {
  ui.error.textContent = '';
  ui.error.classList.add('hidden');
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function checkModel() {
  if (!('LanguageModel' in self)) {
    ui.status.textContent = 'Modèle: indisponible';
    ui.status.title = "L'API Prompt n'est pas exposée dans ce contexte. Activez chrome://flags/#prompt-api-for-gemini-nano et /#optimization-guide-on-device-model.";
    return false;
  }
  try {
    const availability = await LanguageModel.availability();
    ui.status.textContent = `Modèle: ${availability}`;
    return availability === 'available' || availability === 'downloadable' || availability === 'downloading';
  } catch (e) {
    ui.status.textContent = 'Modèle: erreur';
    showError(String(e?.message || e));
    return false;
  }
}

async function extractAd() {
  clearError();
  const tab = await getActiveTab();
  if (!tab?.url?.includes('leboncoin.fr')) {
    showError("Cet onglet n'est pas une page Leboncoin.");
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_AD' });
    if (!res?.ok) throw new Error(res?.error || 'Extraction impossible');
    currentAd = res.data;
    ui.adTitle.textContent = currentAd.title || '(sans titre)';
    ui.adPrice.textContent = currentAd.price ? `💶 ${currentAd.price}` : '';
    ui.adLocation.textContent = currentAd.location ? `📍 ${currentAd.location}` : '';
    ui.adInfo.classList.remove('hidden');
    ui.btnAnalyze.disabled = false;
  } catch (e) {
    showError(
      "Impossible d'extraire l'annonce. Rechargez la page Leboncoin pour activer le content script. " +
        String(e?.message || e),
    );
  }
}

function buildPrompt(ad) {
  const criteriaStr = ad.criteria
    ? Object.entries(ad.criteria).map(([k, v]) => `- ${k}: ${v}`).join('\n')
    : '(aucun)';
  return `Tu es un assistant qui aide un acheteur à évaluer une annonce Leboncoin.
Analyse l'annonce ci-dessous et fournis une réponse structurée et concise en français :

1. Résumé en 1-2 phrases.
2. Points positifs (3 max).
3. Points de vigilance / signaux suspects (3 max).
4. Questions à poser au vendeur (3 max).
5. Estimation de cohérence du prix (faible / cohérent / élevé) avec une justification courte.

ANNONCE :
- Titre : ${ad.title || 'N/A'}
- Prix : ${ad.price || 'N/A'}
- Lieu : ${ad.location || 'N/A'}
- Catégorie : ${ad.category || 'N/A'}
- Caractéristiques :
${criteriaStr}

Description :
"""
${(ad.description || '').slice(0, 4000)}
"""`;
}

async function analyzeAd() {
  clearError();
  if (!currentAd) {
    showError("Extraire l'annonce d'abord.");
    return;
  }
  if (!('LanguageModel' in self)) {
    showError("L'API LanguageModel n'est pas disponible. Activez les flags Chrome correspondants.");
    return;
  }

  ui.btnAnalyze.disabled = true;
  ui.result.classList.remove('hidden');
  ui.resultText.textContent = 'Analyse en cours…';

  let session;
  try {
    session = await LanguageModel.create({
      initialPrompts: [
        {
          role: 'system',
          content:
            "Tu es un expert prudent du marché de l'occasion en France, spécialisé sur Leboncoin. Tu réponds toujours en français de manière factuelle et concise.",
        },
      ],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          ui.status.textContent = `Téléchargement modèle: ${(e.loaded * 100).toFixed(0)}%`;
        });
      },
    });

    const prompt = buildPrompt(currentAd);
    const stream = session.promptStreaming(prompt);
    ui.resultText.textContent = '';
    for await (const chunk of stream) {
      ui.resultText.textContent += chunk;
    }
  } catch (e) {
    showError(`Échec de l'analyse: ${e?.message || e}`);
  } finally {
    session?.destroy?.();
    ui.btnAnalyze.disabled = false;
  }
}

ui.btnExtract.addEventListener('click', extractAd);
ui.btnAnalyze.addEventListener('click', analyzeAd);

(async () => {
  await checkModel();
  // Auto-extraction au chargement si on est sur une page Leboncoin
  const tab = await getActiveTab();
  if (tab?.url?.includes('leboncoin.fr/ad/') || /leboncoin\.fr\/.+\.htm/.test(tab?.url || '')) {
    extractAd();
  }
})();

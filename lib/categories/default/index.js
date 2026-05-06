// Catégorie fallback : pas de pipeline web/comparables, juste une analyse
// libre (résumé + points d'attention) sur titre/description/prix.

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", maxLength: 600 },
    pros: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 4 },
    cons: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 4 },
    questions: { type: "array", items: { type: "string", maxLength: 120 }, maxItems: 5 },
  },
  required: ["summary", "pros", "cons", "questions"],
  additionalProperties: false,
};

function buildPrompt(ad) {
  const text = [
    ad.subject ? `Titre: ${ad.subject}` : null,
    ad.price ? `Prix demandé: ${ad.price} EUR` : null,
    ad.city ? `Ville: ${ad.city}` : null,
    ad.body ? `\nDescription:\n${String(ad.body).slice(0, 3000)}` : null,
  ].filter(Boolean).join("\n");
  return `Analyse cette annonce Leboncoin et reponds en JSON strict :
- summary : 2 phrases max, factuel
- pros : 2-4 points positifs concrets de l'annonce (max 10 mots)
- cons : 2-4 points d'attention / signaux faibles (max 10 mots) — sans speculation arnaque
- questions : 3-5 questions a poser au vendeur

REPONSE EN FRANCAIS.

ANNONCE :
"""
${text}
"""`;
}

async function enrichAd({ ad, llm, settings, log, phase }) {
  phase("identity_done", { identity: { marque: null, modele: null } });
  phase("web_done", { priceSummary: null });
  phase("comparables_done", { count: 0, comparables: [] });
  phase("synth_start");

  let synth = null;
  try {
    synth = await llm.json({
      system: "Tu analyses des annonces Leboncoin en francais. Tu reponds uniquement en JSON strict.",
      prompt: buildPrompt(ad),
      schema: SCHEMA,
      model: settings.ollamaSynthModel || settings.ollamaExtractModel,
      timeout: 60000,
    });
  } catch (e) { log(`[synth:error] ${e.message}`); }
  if (!synth) synth = { summary: "(analyse indisponible)", pros: [], cons: [], questions: [] };

  const result = {
    category: "default",
    ad_url: ad.url,
    ad_subject: ad.subject,
    asking_price_eur: ad.price ? Number(ad.price) : null,
    summary: synth.summary,
    pros: synth.pros,
    cons: synth.cons,
    questions: synth.questions,
    reasoning: synth.summary,
    deal_score: null,
    condition_score: null,
    estimated_market_eur: null,
    msrp_eur: null,
    retail_eur: null,
    retail_source: null,
    _sources: { backend: llm.backend?.kind },
  };
  phase("done", { result });
  return result;
}

export default {
  id: "default",
  label: "Annonce générique",
  detect: () => true,
  enrichAd,
  uiRendererPath: null,
};

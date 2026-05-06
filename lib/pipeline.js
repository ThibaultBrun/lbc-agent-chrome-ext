// Pipeline d'enrichissement — port de bike_agent/pipeline.py.
// Côté service worker : orchestre tout. Pour l'extraction Nano, délègue au content script
// via callbacks (Nano est exposé sur la fenêtre, pas dans le service worker).

import {
  buildIdentityPrompt,
  IDENTITY_SCHEMA,
  postProcessIdentity,
  sourceProfileForUrl,
  bikeDescription,
} from "./identity.js";
import { buildSearchQueries, buildRankPrompt, RANK_SCHEMA } from "./ranking.js";
import { webSearch } from "./search.js";
import { fetchPageText, extractPricesFromText, buildPriceExtractionPrompt, PRICE_EXTRACTION_SCHEMA } from "./pages.js";
import { fetchAllComparables } from "./comparables.js";
import {
  buildSynthesisPrompt,
  SYNTHESIS_SCHEMA,
  summarizePrices,
  computeDealScores,
  decoteFactor,
} from "./synth.js";
import { ollamaChat, getSettings, selectBackend } from "./llm.js";
import { median } from "./utils.js";

// Format texte unifié à partir d'une annonce (sujet + body + attributs)
export function renderAd(ad) {
  if (typeof ad === "string") return ad;
  const parts = [];
  if (ad.subject) parts.push(`Titre original\n${ad.subject}`);
  let body = ad.body || "";
  if (body.length > 1500) body = body.slice(0, 1500) + "...";
  if (body) parts.push(`Description complete\n${body}`);
  const attrs = ad.attributes || {};
  const skip = new Set([
    "profile_picture_url", "rating_score", "rating_count", "is_bundleable",
    "purchase_cta_visible", "negotiation_cta_visible", "shipping_type",
    "shippable", "estimated_parcel_size", "estimated_parcel_weight", "payment_methods",
  ]);
  const attrLines = Object.keys(attrs)
    .filter((k) => !skip.has(k) && attrs[k])
    .sort()
    .map((k) => `  - ${k}: ${attrs[k]}`)
    .join("\n");
  if (attrLines) parts.push(`Attributs Leboncoin\n${attrLines}`);
  if (ad.price) parts.push(`Prix: ${ad.price} EUR`);
  if (ad.city) parts.push(`Ville: ${ad.city}`);
  return parts.join("\n\n");
}

// Adaptateur LLM. Côté service worker on appelle Ollama en HTTP.
// Pour Nano et WebLLM, on passe par l'offscreen document via les bridges.
export class LlmRouter {
  constructor({ backend, nanoBridge, webllmBridge, onProgress }) {
    this.backend = backend;          // { kind: 'ollama'|'nano'|'webllm'|'none', url?, model? }
    this.nanoBridge = nanoBridge;
    this.webllmBridge = webllmBridge;
    this.onProgress = onProgress;
  }

  async json({ system, prompt, schema, model, temperature = 0, timeout = 60000 }) {
    if (this.backend.kind === "ollama") {
      const out = await ollamaChat({
        url: this.backend.url,
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        format: schema,
        temperature,
        timeout,
      });
      return safeParseJson(out);
    }
    if (this.backend.kind === "webllm" && this.webllmBridge) {
      const out = await this.webllmBridge({
        prompt, system, schema,
        model: this.backend.model,
        onProgress: this.onProgress,
      });
      return safeParseJson(out);
    }
    if (this.backend.kind === "nano" && this.nanoBridge) {
      const out = await this.nanoBridge({ prompt, system, schema, onProgress: this.onProgress });
      return safeParseJson(out);
    }
    throw new Error(`No LLM backend available (kind=${this.backend.kind})`);
  }

  async text({ system, prompt, model, temperature = 0.2, timeout = 90000, onChunk }) {
    if (this.backend.kind === "ollama") {
      const messages = [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ];
      if (onChunk) {
        const { ollamaChatStream } = await import("./llm.js");
        return ollamaChatStream({ url: this.backend.url, model, messages, temperature, onChunk });
      }
      return ollamaChat({ url: this.backend.url, model, messages, temperature, timeout });
    }
    if (this.backend.kind === "webllm" && this.webllmBridge) {
      return this.webllmBridge({
        prompt, system,
        model: this.backend.model,
        stream: !!onChunk, onChunk,
        onProgress: this.onProgress,
      });
    }
    if (this.backend.kind === "nano" && this.nanoBridge) {
      return this.nanoBridge({ prompt, system, stream: !!onChunk, onChunk, onProgress: this.onProgress });
    }
    throw new Error(`No LLM backend available (kind=${this.backend.kind})`);
  }
}

function safeParseJson(s) {
  if (!s) return null;
  // Cherche un objet JSON dans la réponse (Nano peut générer du markdown autour)
  const trimmed = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(trimmed); } catch { /* try harder */ }
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* fail */ }
  }
  return null;
}

// ─── Pipeline principal ────────────────────────────────────────────────

export async function enrichAd({ ad, llm, settings, emit }) {
  const log = (...args) => emit?.({ type: "log", message: args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ") });
  const phase = (p, extra = {}) => emit?.({ type: "phase", phase: p, ...extra });
  const t0 = Date.now();

  // 1) Extraction d'identité
  phase("identity_start");
  const adText = renderAd(ad);
  let identity = null;
  try {
    const sys = "Tu es un extracteur d'informations. Tu reponds uniquement en JSON strict.";
    const raw = await llm.json({
      system: sys,
      prompt: buildIdentityPrompt(adText),
      schema: IDENTITY_SCHEMA,
      model: settings.ollamaExtractModel,
      timeout: 45000,
    });
    identity = postProcessIdentity(raw || {}, adText, ad.attributes || {});
  } catch (e) {
    log(`[identity:error] ${e.message}`);
    identity = postProcessIdentity({}, adText, ad.attributes || {});
  }
  phase("identity_done", { identity });

  // 2) Recherche web (queries → résultats → ranking → fetch + extraction prix)
  phase("web_start");
  const webResults = [];
  if (settings.fetchPages !== false && (identity.marque || identity.modele)) {
    try {
      const { primary, fallback } = buildSearchQueries(identity);
      const allQueries = [...primary, ...fallback].slice(0, 5);
      const seen = new Set();
      const candidates = [];
      for (const q of allQueries) {
        const results = await webSearch(q.query, settings.maxWebResults || 6, log);
        for (const r of results) {
          if (seen.has(r.url)) continue;
          seen.add(r.url);
          const profile = sourceProfileForUrl(r.url, identity);
          candidates.push({ ...r, source_name: profile.name, source_domain: profile.domain, source_priority: profile.priority, source_type: profile.type });
        }
        if (candidates.length >= 12) break;
      }
      phase("web_candidates", { count: candidates.length });

      // Ranking via LLM (top-k)
      let kept = candidates;
      try {
        const ranked = await llm.json({
          system: "Tu tries des resultats web pour identifier les sources techniques et de prix d'un velo. Tu reponds uniquement en JSON strict.",
          prompt: buildRankPrompt(identity, candidates, 6),
          schema: RANK_SCHEMA,
          model: settings.ollamaExtractModel,
          timeout: 25000,
        });
        const indices = (ranked?.selected || []).map((s) => s.i).filter((i) => Number.isInteger(i));
        kept = indices.map((i) => candidates[i]).filter(Boolean);
      } catch (e) {
        log(`[rank:error] ${e.message} — keep top by priority`);
        kept = candidates.slice().sort((a, b) => a.source_priority - b.source_priority).slice(0, 6);
      }
      phase("web_ranked", { count: kept.length });

      // Fetch pages + extraction prix
      for (const r of kept) {
        const profile = { name: r.source_name, domain: r.source_domain, type: r.source_type };
        const fetched = await fetchPageText(r.url, { timeout: 18000 });
        if (!fetched.ok) { webResults.push({ ...r, ok: false, prices_in_page: [] }); continue; }
        const pageText = fetched.text;
        let prices = [];
        try {
          const out = await llm.json({
            system: "Tu identifies des prix dans des pages produit. Tu reponds uniquement en JSON strict.",
            prompt: buildPriceExtractionPrompt(identity, pageText, r.url, profile),
            schema: PRICE_EXTRACTION_SCHEMA,
            model: settings.ollamaExtractModel,
            timeout: 30000,
          });
          prices = (out?.prices || []).map((p) => ({ ...p, source_name: profile.name, source_domain: profile.domain, source: r.url }));
        } catch (e) {
          log(`[price:error:${r.source_name}] ${e.message}`);
          // Fallback regex (sans classification)
          prices = extractPricesFromText(pageText).slice(0, 5).map((p) => ({ ...p, kind: "unknown", source_name: profile.name, source_domain: profile.domain, source: r.url }));
        }
        webResults.push({ ...r, ok: true, prices_in_page: prices });
        emit?.({ type: "log", message: `[page:done] ${r.source_name} | ${prices.length} prix` });
      }
    } catch (e) {
      log(`[web:error] ${e.message}`);
    }
  }
  const priceSummary = summarizePrices(webResults);
  phase("web_done", { priceSummary });

  // 3) Comparables Troc Vélo + LBC
  phase("comparables_start");
  let comparables = [];
  try {
    comparables = await fetchAllComparables(identity, ad.url, settings, log);
  } catch (e) { log(`[comparables:error] ${e.message}`); }
  phase("comparables_done", { count: comparables.length, comparables });

  // 4) Synthèse
  phase("synth_start");
  const askingPrice = ad.price ? Number(ad.price) : null;
  let synth = null;
  try {
    const sys = "Tu es un expert prudent du marche velo d'occasion en France. Tu reponds uniquement en JSON strict, en francais.";
    synth = await llm.json({
      system: sys,
      prompt: buildSynthesisPrompt(adText, identity, priceSummary, askingPrice, comparables),
      schema: SYNTHESIS_SCHEMA,
      model: settings.ollamaSynthModel,
      timeout: 90000,
    });
  } catch (e) {
    log(`[synth:error] ${e.message}`);
  }
  if (!synth) {
    // Fallback minimal si la synthèse échoue
    synth = {
      brand: identity.marque || null,
      model: identity.modele || null,
      year: identity.annee || null,
      frame_material: null,
      wheel_size: identity.taille_roues || null,
      electric: identity.electric ?? null,
      size_label: identity.taille_cadre || null,
      vtt_category: null,
      msrp_eur: priceSummary.estimate.msrp_eur || null,
      retail_eur: priceSummary.estimate.retail_eur || null,
      retail_source: null,
      condition_score: 60,
      estimated_market_eur: priceSummary.estimate.used_eur || (priceSummary.estimate.retail_eur ? priceSummary.estimate.retail_eur * decoteFactor(identity.annee) : 0),
      deal_score: 50,
      reasoning: "Synthese LLM indisponible. Estimation base sur les comparables et les signaux web.",
      pros: [],
      cons: ["Pas de synthese IA disponible"],
    };
  }

  // Score deal déterministe (toujours par-dessus le LLM)
  const allPrices = comparables.filter((c) => c.price_eur).map((c) => c.price_eur);
  const tierPrices = comparables.filter((c) => c.price_eur && c.tier_match === true).map((c) => c.price_eur);
  const lbcMedianGlobal = median(allPrices);
  const lbcMedianTier = median(tierPrices);
  const scores = computeDealScores({
    asking: askingPrice,
    msrp: synth.msrp_eur,
    retail: synth.retail_eur,
    year: synth.year,
    lbcMedianTier,
    lbcMedianGlobal,
  });
  if (scores.deal_score != null) synth.deal_score = scores.deal_score;

  const result = {
    ad_url: ad.url,
    ad_subject: ad.subject,
    asking_price_eur: askingPrice,
    duration_s: (Date.now() - t0) / 1000,
    ...synth,
    _sources: {
      extracted_identity: identity,
      msrp_eur_web: priceSummary.estimate.msrp_eur,
      retail_eur_web: priceSummary.estimate.retail_eur,
      used_eur_web: priceSummary.estimate.used_eur,
      web_results: webResults.map((r) => ({
        url: r.url,
        title: r.title,
        source_name: r.source_name,
        prices: r.prices_in_page || [],
      })),
      comparables_count: comparables.length,
      comparables_median_eur: lbcMedianGlobal ? Math.round(lbcMedianGlobal) : null,
      comparables_median_tier_eur: lbcMedianTier ? Math.round(lbcMedianTier) : null,
      comparables_samples: comparables.slice(0, 10),
      deal_scores: scores,
      backend: llm.backend?.kind,
    },
  };
  phase("done", { result });
  return result;
}

// Module catégorie vélo — entrée publique.
// Expose : detect, enrichAd, uiRenderer, id, label.

import { detect } from "./detect.js";
import { buildIdentityPrompt, IDENTITY_SCHEMA, postProcessIdentity, sourceProfileForUrl } from "./identity.js";
import { buildSearchQueries, buildRankPrompt, RANK_SCHEMA } from "./ranking.js";
import { webSearch } from "../../core/search.js";
import { fetchPageText, extractPricesFromText, PRICE_EXTRACTION_SCHEMA } from "../../core/pages.js";
import { buildPriceExtractionPrompt } from "./pages.js";
import { fetchAllComparables } from "./comparables.js";
import {
  buildSynthesisPrompt,
  SYNTHESIS_SCHEMA,
  computeBikeDealScores,
  decoteFactor,
} from "./synth.js";
import {
  BIKE_SPECS_SCHEMA,
  buildSpecsExtractionPrompt,
  mergeSpecs,
  specsSourcePriority,
} from "./specs.js";
import { summarizePrices } from "../../core/synth-base.js";
import { median } from "../../core/utils.js";
import { EXTRA_EXCLUDED_DOMAINS } from "./catalog.js";

// Compte le nombre de champs non-null dans un objet specs (incl. geometry imbrique)
function countFilledSpecs(specs) {
  if (!specs) return 0;
  let count = 0;
  for (const k of Object.keys(specs)) {
    if (k === "geometry" && specs.geometry) {
      for (const gk of Object.keys(specs.geometry)) if (specs.geometry[gk] != null) count++;
    } else if (specs[k] != null) {
      count++;
    }
  }
  return count;
}

// Format texte unifié à partir d'une annonce LBC vélo
function renderAd(ad) {
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

async function enrichAd({ ad, llm, settings, emit, log, phase }) {
  const t0 = Date.now();
  const progress = (pct, label) => emit?.({ type: "analysis_progress", progress: pct, label });

  // 1) Identité
  phase("identity_start");
  progress(0.05, "Extraction de l'identité du vélo");
  log(`[identity:start] backend=${llm.backend?.kind} model=${settings.ollamaExtractModel || "(nano/webllm)"}`);
  const adText = renderAd(ad);
  let identity = null;
  try {
    const raw = await llm.json({
      system: "Tu es un extracteur d'informations. Tu reponds uniquement en JSON strict.",
      prompt: buildIdentityPrompt(adText),
      schema: IDENTITY_SCHEMA,
      model: settings.ollamaExtractModel,
      timeout: 45000,
    });
    identity = postProcessIdentity(raw || {}, adText, ad.attributes || {});
    log(`[identity:done] ${identity.marque || "?"} ${identity.modele || "?"} ${identity.annee || ""} ${identity.taille_roues ? identity.taille_roues + '"' : ""}`);
  } catch (e) {
    log(`[identity:error] ${e.message}`);
    identity = postProcessIdentity({}, adText, ad.attributes || {});
  }
  phase("identity_done", { identity });
  progress(0.20, "Identité extraite");

  // 2) Recherche web
  phase("web_start");
  progress(0.22, "Recherche du catalogue web");
  const webResults = [];
  log(`[web:gate] fetchPages=${settings.fetchPages} marque=${identity.marque || "?"} modele=${identity.modele || "?"}`);
  if (settings.fetchPages !== false && (identity.marque || identity.modele)) {
    try {
      const { primary, fallback } = buildSearchQueries(identity);
      const allQueries = [...primary, ...fallback].slice(0, 5);
      log(`[web:queries] ${allQueries.length} requêtes prévues`);
      const seen = new Set();
      const candidates = [];
      // On n'accepte QUE les sources des 3 listes officielles + magazines de
      // reference. Tout autre domaine est rejete (pas d'extraction de prix sur
      // un blog/forum/site random qui pollue le LLM).
      const ACCEPTED_TYPES = new Set(["manufacturer", "retailer", "refurbisher", "magazine"]);

      // Filet de securite : si une URL Bing /ck/a passe le webSearch sans etre
      // deroulee (cas rare mais possible si parser HTML rate), on tente de
      // l'unwrapper ici avant tout traitement aval.
      function rescueBingUrl(url) {
        if (!url || !url.includes("bing.com/ck/a")) return url;
        try {
          const decoded = url.replace(/&amp;/g, "&");
          const u = new URL(decoded);
          let target = u.searchParams.get("u") || "";
          if (target.startsWith("a1")) {
            target = target.slice(2);
            const padding = "=".repeat((4 - (target.length % 4)) % 4);
            return atob(target.replace(/-/g, "+").replace(/_/g, "/") + padding);
          }
        } catch { /* ignore */ }
        return url;
      }
      for (let qi = 0; qi < allQueries.length; qi++) {
        const q = allQueries[qi];
        log(`[search:${qi + 1}/${allQueries.length}] "${q.query}" (${q.source})`);
        const results = await webSearch(q.query, settings.maxWebResults || 6, {
          log,
          excludedDomains: EXTRA_EXCLUDED_DOMAINS,
        });
        log(`[search:${qi + 1}] ${results.length} résultats`);
        let kept = 0, rejected = 0;
        for (const r0 of results) {
          // Filet : on rescue les URLs Bing /ck/a qui auraient echappe au unwrap initial.
          const cleanUrl = rescueBingUrl(r0.url);
          const r = cleanUrl !== r0.url ? { ...r0, url: cleanUrl } : r0;
          if (seen.has(r.url)) continue;
          seen.add(r.url);
          const profile = sourceProfileForUrl(r.url, identity);
          if (!ACCEPTED_TYPES.has(profile.type)) {
            log(`  ✗ ${profile.domain} (type=${profile.type}) hors liste, ignoré`);
            rejected++;
            continue;
          }
          log(`  ✓ ${profile.name} [${profile.type}] | ${r.url}`);
          candidates.push({ ...r, source_name: profile.name, source_domain: profile.domain, source_priority: profile.priority, source_type: profile.type });
          kept++;
        }
        log(`[search:${qi + 1}] ${kept} gardés, ${rejected} hors liste`);
        progress(0.22 + 0.13 * ((qi + 1) / allQueries.length), `Recherche ${qi + 1}/${allQueries.length}`);
        if (candidates.length >= 12) break;
      }
      phase("web_candidates", { count: candidates.length });
      log(`[web:candidates] ${candidates.length} candidats uniques`);

      progress(0.36, "Tri des résultats par pertinence");
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
        log(`[rank:done] ${kept.length} sources retenues sur ${candidates.length}`);
      } catch (e) {
        log(`[rank:error] ${e.message} — keep top by priority`);
        kept = candidates.slice().sort((a, b) => a.source_priority - b.source_priority).slice(0, 6);
      }
      phase("web_ranked", { count: kept.length });

      for (let i = 0; i < kept.length; i++) {
        const r = kept[i];
        const profile = { name: r.source_name, domain: r.source_domain, type: r.source_type };
        log(`[fetch:${i + 1}/${kept.length}] ${profile.name} | ${r.url}`);
        progress(0.40 + 0.30 * (i / kept.length), `Lecture ${i + 1}/${kept.length} : ${profile.name}`);
        const fetched = await fetchPageText(r.url, { timeout: 18000 });
        if (!fetched.ok) {
          log(`  ✗ fetch échoué (${fetched.error || "?"})`);
          webResults.push({ ...r, ok: false, prices_in_page: [] });
          continue;
        }
        log(`  ✓ ${fetched.text.length} car. lus via ${fetched.via}`);
        const pageText = fetched.text;
        let prices = [];
        let llmOk = false;
        try {
          const out = await llm.json({
            system: "Tu identifies des prix dans des pages produit. Tu reponds uniquement en JSON strict.",
            prompt: buildPriceExtractionPrompt(identity, pageText, r.url, profile),
            schema: PRICE_EXTRACTION_SCHEMA,
            model: settings.ollamaExtractModel,
            timeout: 30000,
          });
          prices = (out?.prices || []).map((p) => ({ ...p, source_name: profile.name, source_domain: profile.domain, source: r.url }));
          llmOk = true;
          log(`  [llm:${profile.type}] ${prices.length} prix extraits par LLM`);
        } catch (e) {
          log(`  [price:llm:error] ${e.message}`);
        }
        // Fallback regex : si Nano n'a rien trouve mais que la page contient des prix,
        // on les recupere quand meme avec un kind heuristique selon le type de source.
        if (prices.length === 0) {
          const regexPrices = extractPricesFromText(pageText).slice(0, 5);
          if (regexPrices.length) {
            // Heuristique kind par source type
            const defaultKind =
              profile.type === "manufacturer" ? "msrp" :
              profile.type === "retailer" ? "retail" :
              profile.type === "refurbisher" ? "used" :
              profile.type === "magazine" ? "msrp" :
              "unknown";
            prices = regexPrices.map((p) => ({ ...p, kind: defaultKind, _regex: true, source_name: profile.name, source_domain: profile.domain, source: r.url }));
            log(`  [llm:fallback-regex] ${prices.length} prix regex avec kind=${defaultKind} (LLM ${llmOk ? "vide" : "ko"})`);
          } else {
            log(`  [llm:no-prices] aucun prix trouve sur la page`);
          }
        }
        // Refurbisher (Upway, Buycycle, MyVeloShop, Rebike...) : prix DEJA decotes
        // (vente d'occasion). On force tout en 'used' pour qu'ils nourrissent le
        // signal occasion plutot que le retail neuf.
        if (profile.type === "refurbisher") {
          prices = prices.map((p) => {
            if (["retail", "current", "sale", "msrp"].includes(p.kind)) {
              return { ...p, kind: "used", _refurb: true };
            }
            return p;
          });
        }
        // Filtre source : un prix kind='retail'/'current'/'sale' n'est valable QUE
        // si la source est un revendeur connu de NEUF (KNOWN_RETAILERS) ou constructeur.
        // Sinon on rétrograde en 'unknown' (le LLM a pu classer un prix random).
        if (profile.type !== "retailer" && profile.type !== "manufacturer") {
          prices = prices.map((p) => {
            if (["retail", "current", "sale"].includes(p.kind)) {
              return { ...p, kind: "unknown", _downgraded: true };
            }
            return p;
          });
        }
        // Pareil : un kind='msrp' n'est valable que sur constructeur, magazine
        // ou revendeur de neuf. Pas sur un refurbisher ni 'other'.
        if (profile.type !== "manufacturer" && profile.type !== "magazine" && profile.type !== "retailer") {
          prices = prices.map((p) => p.kind === "msrp" ? { ...p, kind: "unknown", _downgraded: true } : p);
        }
        // Extraction caracteristiques techniques (specs) : seulement depuis
        // constructeur + magazine, ou les fiches sont les plus fiables.
        let specs = null;
        if (profile.type === "manufacturer" || profile.type === "magazine") {
          try {
            const out = await llm.json({
              system: "Tu extrais les caracteristiques techniques d'un velo a partir d'une fiche produit ou d'un test. Tu reponds uniquement en JSON strict.",
              prompt: buildSpecsExtractionPrompt(identity, pageText, r.url, profile),
              schema: BIKE_SPECS_SCHEMA,
              model: settings.ollamaExtractModel,
              timeout: 30000,
            });
            specs = out || null;
            if (specs) {
              const filled = countFilledSpecs(specs);
              log(`  → specs: ${filled} champs remplis`);
            }
          } catch (e) {
            log(`  [specs:error] ${e.message}`);
          }
        }
        webResults.push({ ...r, ok: true, prices_in_page: prices, specs_in_page: specs });
        const summary = prices.length ? prices.map((p) => `${p.amount_eur}€${p.kind ? "/" + p.kind : ""}`).join(", ") : "aucun";
        log(`  → ${prices.length} prix : ${summary}`);
      }
    } catch (e) {
      log(`[web:error] ${e.message}`);
    }
  } else {
    log("[web:skip] identité incomplète ou recherche désactivée");
  }
  const priceSummary = summarizePrices(webResults);
  log(`[web:summary] msrp=${priceSummary.estimate.msrp_eur || "?"}€ retail=${priceSummary.estimate.retail_eur || "?"}€ used=${priceSummary.estimate.used_eur || "?"}€`);

  // Fusion des specs collectees, en priorite constructeur > magazine > retailer
  const specsCandidates = webResults
    .filter((r) => r.specs_in_page)
    .map((r) => ({ specs: r.specs_in_page, profile: { type: r.source_type, name: r.source_name } }))
    .sort((a, b) => specsSourcePriority(a.profile.type) - specsSourcePriority(b.profile.type));
  const mergedSpecs = mergeSpecs(specsCandidates);
  if (mergedSpecs) {
    const filled = countFilledSpecs(mergedSpecs);
    log(`[specs:merged] ${filled} caracteristiques techniques agregees depuis ${specsCandidates.length} source(s)`);
  } else {
    log(`[specs:merged] aucune caracteristique technique extraite`);
  }

  phase("web_done", { priceSummary, specs: mergedSpecs });
  progress(0.70, "Catalogue web analysé");

  // 3) Comparables
  phase("comparables_start");
  progress(0.72, "Recherche de comparables");
  let comparables = [];
  try {
    comparables = await fetchAllComparables(identity, ad.url, settings, log);
    const lbcCount = comparables.filter((c) => c.source === "lbc").length;
    const trocCount = comparables.filter((c) => c.source === "trocvelo").length;
    log(`[comparables:summary] ${comparables.length} total (LBC: ${lbcCount}, Troc Vélo: ${trocCount})`);
    for (const c of comparables.slice(0, 8)) {
      log(`  • [${(c.source || "?").toUpperCase()}] ${c.price_eur}€ — ${(c.subject || "").slice(0, 60)}`);
    }
  } catch (e) { log(`[comparables:error] ${e.message}`); }
  phase("comparables_done", { count: comparables.length, comparables });
  progress(0.85, "Comparables collectés");

  // 4) Synthèse
  phase("synth_start");
  progress(0.87, "Synthèse IA en cours");
  const askingPrice = ad.price ? Number(ad.price) : null;
  log(`[synth:start] model=${settings.ollamaSynthModel || "(nano/webllm)"}`);
  let synth = null;
  try {
    synth = await llm.json({
      system: "Tu es un expert prudent du marche velo d'occasion en France. Tu reponds uniquement en JSON strict, en francais.",
      prompt: buildSynthesisPrompt(adText, identity, priceSummary, askingPrice, comparables),
      schema: SYNTHESIS_SCHEMA,
      model: settings.ollamaSynthModel,
      timeout: 90000,
    });
    log(`[synth:done] deal_score=${synth?.deal_score || "?"} estimated_market=${synth?.estimated_market_eur || "?"}€`);
  } catch (e) {
    log(`[synth:error] ${e.message}`);
  }
  if (!synth) {
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
      estimated_market_eur: priceSummary.estimate.used_eur || (priceSummary.estimate.retail_eur ? priceSummary.estimate.retail_eur * decoteFactor(identity.annee, { electric: identity.electric === true }) : 0),
      deal_score: 50,
      reasoning: "Synthese LLM indisponible. Estimation base sur les comparables et les signaux web.",
      pros: [],
      cons: ["Pas de synthese IA disponible"],
    };
  }

  // Score deal déterministe : on l'applique seulement si on a des signaux fiables
  // (comparables OU prix neuf web). Sinon on garde le score du LLM, qui tire parti
  // de sa connaissance catalogue, plutôt que d'imposer un calcul basé sur des prix
  // potentiellement hallucinés par le LLM.
  const allPrices = comparables.filter((c) => c.price_eur).map((c) => c.price_eur);
  const tierPrices = comparables.filter((c) => c.price_eur && c.tier_match === true).map((c) => c.price_eur);
  const lbcMedianGlobal = median(allPrices);
  const lbcMedianTier = median(tierPrices);
  const hasComparables = allPrices.length >= 3;
  const hasWebPrice = !!(priceSummary.estimate.msrp_eur || priceSummary.estimate.retail_eur);
  const scores = computeBikeDealScores({
    asking: askingPrice,
    msrp: synth.msrp_eur,
    retail: synth.retail_eur,
    year: synth.year,
    electric: synth.electric === true,
    lbcMedianTier,
    lbcMedianGlobal,
    comparablesCount: allPrices.length,
  });
  if (scores.deal_score != null && (hasComparables || hasWebPrice)) {
    log(`[deal:override] LLM=${synth.deal_score} → déterministe=${scores.deal_score} (signaux: comparables=${allPrices.length}, web=${hasWebPrice ? "oui" : "non"})`);
    synth.deal_score = scores.deal_score;
  } else if (scores.deal_score != null) {
    log(`[deal:keep_llm] score LLM=${synth.deal_score} conservé (pas assez de signaux fiables : comparables=${allPrices.length}, web=${hasWebPrice ? "oui" : "non"})`);
  }

  // Override estimated_market_eur : le LLM tend a recopier asking_price quand il
  // manque de signal. Si on a >=3 comparables, leur mediane est plus fiable.
  if (allPrices.length >= 3) {
    const usedReference = lbcMedianTier || lbcMedianGlobal;
    if (usedReference && Math.abs(usedReference - synth.estimated_market_eur) > usedReference * 0.05) {
      log(`[market:override] LLM estimated_market=${synth.estimated_market_eur}€ → mediane comparables=${Math.round(usedReference)}€`);
      synth.estimated_market_eur = Math.round(usedReference);
    }
  }

  // Cherche une URL source qui pointe vers une vraie page constructeur/revendeur,
  // pour permettre à l'utilisateur de cliquer et vérifier le prix.
  // On prend la 1re source du kind voulu (priorisée par source_priority dans
  // summarizePrices), avec validation de l'URL.
  function isValidSourceUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      // Pas de redirect Bing : tu finis sur une page de recherche, pas de produit
      if (u.hostname.endsWith("bing.com") && u.pathname.includes("/ck/a")) return false;
      // Pas de page de recherche generique
      if (/(?:^|\.)(?:bing|google|duckduckgo|qwant)\.[a-z]+/.test(u.hostname)) return false;
      return ["http:", "https:"].includes(u.protocol);
    } catch { return false; }
  }
  function findFirstSource(kinds) {
    for (const k of kinds) {
      const arr = priceSummary.by_kind?.[k] || [];
      // On filtre sur les URLs valides uniquement (eviter les liens casses ou
      // les redirects Bing non resolus).
      const valid = arr.find((p) => isValidSourceUrl(p.source));
      if (valid) {
        return { url: valid.source, name: valid.source_name, amount: valid.amount_eur };
      }
    }
    return null;
  }
  const msrpSource = findFirstSource(["msrp"]);
  const retailSource = findFirstSource(["retail", "current", "sale"]);
  // Source occasion (refurbisher) — utile pour afficher un lien sur la cellule "Marche occasion"
  const usedSource = findFirstSource(["used"]);
  if (msrpSource) synth.msrp_source_url = msrpSource.url;
  if (retailSource) {
    synth.retail_source_url = retailSource.url;
    if (!synth.retail_source && retailSource.name) synth.retail_source = retailSource.name;
  }
  if (usedSource) synth.used_source_url = usedSource.url;

  // Récupère les specs fusionnées sur synth pour l'overlay
  if (mergedSpecs) synth.specs = mergedSpecs;

  const result = {
    category: "velo",
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
  log(`[done] ${((Date.now() - t0) / 1000).toFixed(1)}s — deal_score=${synth.deal_score} estimated_market=${synth.estimated_market_eur}€`);
  progress(1.0, "Analyse terminée");
  phase("done", { result });
  return result;
}

// ─── Module catégorie ────────────────────────────────────────────────

export default {
  id: "velo",
  label: "Vélo",
  detect,
  enrichAd,
  // uiRenderer importé dynamiquement par overlay (DOM accessible côté content script)
  uiRendererPath: "lib/categories/velo/ui.js",
};

// Module categorie voiture — entree publique.

import { detect } from "./detect.js";
import {
  buildIdentityPrompt,
  IDENTITY_SCHEMA,
  postProcessIdentity,
  sourceProfileForUrl,
} from "./identity.js";
import { buildSearchQueries, buildRankPrompt, RANK_SCHEMA } from "./ranking.js";
import { webSearch } from "../../core/search.js";
import { fetchPageText, extractPricesFromText, PRICE_EXTRACTION_SCHEMA } from "../../core/pages.js";
import { buildPriceExtractionPrompt } from "./pages.js";
import { fetchAllComparables } from "./comparables.js";
import {
  buildSynthesisPrompt,
  SYNTHESIS_SCHEMA,
  computeAutoDealScores,
  decoteFactor,
} from "./synth.js";
import {
  RELIABILITY_SCHEMA,
  buildReliabilityExtractionPrompt,
  buildReliabilityQueries,
  buildFichesAutoQuery,
  classifyReliabilitySource,
  mergeReliabilityReports,
} from "./reliability.js";
import { summarizePrices } from "../../core/synth-base.js";
import { median } from "../../core/utils.js";
import { EXTRA_EXCLUDED_DOMAINS } from "./catalog.js";

// Format texte unifie a partir d'une annonce LBC voiture
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

// Filet rescue Bing /ck/a (cf velo/index.js)
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

async function enrichAd({ ad, llm, settings, emit, log, phase }) {
  const t0 = Date.now();
  const progress = (pct, label) => emit?.({ type: "analysis_progress", progress: pct, label });

  // 1) Identite
  phase("identity_start");
  progress(0.05, "Extraction identité voiture");
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
    log(`[identity:done] ${identity.marque || "?"} ${identity.modele || "?"} ${identity.finition || ""} ${identity.annee || ""} ${identity.motorisation || ""} ${identity.kilometrage_km ? identity.kilometrage_km + "km" : ""}`);
  } catch (e) {
    log(`[identity:error] ${e.message}`);
    identity = postProcessIdentity({}, adText, ad.attributes || {});
  }
  phase("identity_done", { identity });
  progress(0.18, "Identité extraite");

  // 2) Recherche web (catalogue + cote + reliabilite en parallele)
  phase("web_start");
  progress(0.20, "Recherche catalogue + cote + fiabilité");
  const webResults = [];
  const reliabilityReports = [];
  const ACCEPTED_TYPES = new Set(["manufacturer", "retailer", "refurbisher", "magazine", "reliability"]);

  if (settings.fetchPages !== false && (identity.marque || identity.modele)) {
    try {
      const { primary, fallback } = buildSearchQueries(identity);
      // On ajoute aussi les queries fiabilite (priorite haute pour Fiches-Auto)
      const reliabilityQueries = buildReliabilityQueries(identity);
      const fichesAutoQ = buildFichesAutoQuery(identity);
      if (fichesAutoQ) reliabilityQueries.unshift(fichesAutoQ);

      const allQueries = [...primary, ...reliabilityQueries, ...fallback].slice(0, 7);
      log(`[web:queries] ${allQueries.length} requêtes prévues (dont ${reliabilityQueries.length} fiabilité)`);

      const seen = new Set();
      const candidates = [];
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
          const cleanUrl = rescueBingUrl(r0.url);
          const r = cleanUrl !== r0.url ? { ...r0, url: cleanUrl } : r0;
          if (seen.has(r.url)) continue;
          seen.add(r.url);
          const profile = sourceProfileForUrl(r.url, identity);
          if (!ACCEPTED_TYPES.has(profile.type)) {
            rejected++;
            continue;
          }
          log(`  ✓ ${profile.name} [${profile.type}] | ${r.url}`);
          candidates.push({ ...r, source_name: profile.name, source_domain: profile.domain, source_priority: profile.priority, source_type: profile.type });
          kept++;
        }
        log(`[search:${qi + 1}] ${kept} gardés, ${rejected} hors liste`);
        progress(0.20 + 0.13 * ((qi + 1) / allQueries.length), `Recherche ${qi + 1}/${allQueries.length}`);
        if (candidates.length >= 14) break;
      }
      phase("web_candidates", { count: candidates.length });
      log(`[web:candidates] ${candidates.length} candidats uniques`);

      // Ranking LLM
      progress(0.34, "Tri des résultats");
      let kept = candidates;
      try {
        const ranked = await llm.json({
          system: "Tu tries des resultats web pour identifier les sources techniques, de prix et de fiabilite d'une voiture. Tu reponds uniquement en JSON strict.",
          prompt: buildRankPrompt(identity, candidates, 8),
          schema: RANK_SCHEMA,
          model: settings.ollamaExtractModel,
          timeout: 25000,
        });
        const indices = (ranked?.selected || []).map((s) => s.i).filter((i) => Number.isInteger(i));
        kept = indices.map((i) => candidates[i]).filter(Boolean);
        log(`[rank:done] ${kept.length} sources retenues sur ${candidates.length}`);
      } catch (e) {
        log(`[rank:error] ${e.message} — keep top by priority`);
        kept = candidates.slice().sort((a, b) => a.source_priority - b.source_priority).slice(0, 8);
      }
      phase("web_ranked", { count: kept.length });

      // Fetch + extraction prix + extraction fiabilite
      for (let i = 0; i < kept.length; i++) {
        const r = kept[i];
        const profile = { name: r.source_name, domain: r.source_domain, type: r.source_type };
        log(`[fetch:${i + 1}/${kept.length}] ${profile.name} [${profile.type}] | ${r.url}`);
        progress(0.36 + 0.30 * (i / kept.length), `Lecture ${i + 1}/${kept.length} : ${profile.name}`);
        const fetched = await fetchPageText(r.url, { timeout: 18000 });
        if (!fetched.ok) {
          log(`  ✗ fetch échoué (${fetched.error || "?"})`);
          webResults.push({ ...r, ok: false, prices_in_page: [] });
          continue;
        }
        log(`  ✓ ${fetched.text.length} car. lus via ${fetched.via}`);
        const pageText = fetched.text;

        // a) Extraction prix (sauf sur reliability)
        let prices = [];
        if (profile.type !== "reliability") {
          let llmOk = false;
          try {
            const out = await llm.json({
              system: "Tu identifies des prix dans des pages produit ou cote auto. Tu reponds uniquement en JSON strict.",
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
          if (prices.length === 0) {
            const regexPrices = extractPricesFromText(pageText).slice(0, 5).filter((p) => p.amount_eur >= 500 && p.amount_eur <= 200_000);
            if (regexPrices.length) {
              const defaultKind =
                profile.type === "manufacturer" ? "msrp" :
                profile.type === "retailer" ? "retail" :
                profile.type === "refurbisher" ? "used" :
                profile.type === "magazine" ? "used" : // magazine auto = souvent cote occasion
                "unknown";
              prices = regexPrices.map((p) => ({ ...p, kind: defaultKind, _regex: true, source_name: profile.name, source_domain: profile.domain, source: r.url }));
              log(`  [llm:fallback-regex] ${prices.length} prix regex avec kind=${defaultKind} (LLM ${llmOk ? "vide" : "ko"})`);
            }
          }
          // Filtres source (memes regles que velo)
          if (profile.type === "refurbisher") {
            prices = prices.map((p) => ["retail", "current", "sale", "msrp"].includes(p.kind) ? { ...p, kind: "used", _refurb: true } : p);
          }
          if (profile.type !== "retailer" && profile.type !== "manufacturer") {
            prices = prices.map((p) => ["retail", "current", "sale"].includes(p.kind) ? { ...p, kind: "unknown", _downgraded: true } : p);
          }
          if (profile.type !== "manufacturer" && profile.type !== "magazine" && profile.type !== "retailer") {
            prices = prices.map((p) => p.kind === "msrp" ? { ...p, kind: "unknown", _downgraded: true } : p);
          }
        }

        // b) Extraction fiabilite (si source = reliability OU magazine + identity complete)
        let reliability = null;
        if (
          (profile.type === "reliability" || profile.type === "magazine") &&
          identity.marque && identity.modele
        ) {
          try {
            const out = await llm.json({
              system: "Tu extrais des informations de fiabilite et pannes connues d'une voiture depuis une page web. Tu reponds uniquement en JSON strict.",
              prompt: buildReliabilityExtractionPrompt(identity, pageText, r.url, profile),
              schema: RELIABILITY_SCHEMA,
              model: settings.ollamaExtractModel,
              timeout: 35000,
            });
            if (out && (out.reliability_score || (out.known_issues || []).length || (out.must_check || []).length)) {
              reliability = out;
              const sourceTier = classifyReliabilitySource(r.url, profile);
              reliabilityReports.push({ report: out, sourceTier, sourceName: profile.name });
              const issuesCount = (out.known_issues || []).length;
              log(`  [reliability:${sourceTier}] score=${out.reliability_score || "?"} pannes=${issuesCount}`);
            } else {
              log(`  [reliability] vide`);
            }
          } catch (e) {
            log(`  [reliability:error] ${e.message}`);
          }
        }

        webResults.push({ ...r, ok: true, prices_in_page: prices, reliability_in_page: reliability });
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

  // Fusion fiabilite (multi-sources avec ponderation)
  const reliability = mergeReliabilityReports(reliabilityReports);
  if (reliability) {
    log(`[reliability:merged] score=${reliability.reliability_score || "?"} pannes=${(reliability.known_issues || []).length} from ${reliabilityReports.length} sources`);
  }

  phase("web_done", { priceSummary, reliability });
  progress(0.68, "Catalogue + fiabilité analysés");

  // 3) Comparables auto
  phase("comparables_start");
  progress(0.70, "Recherche comparables");
  let comparables = [];
  try {
    comparables = await fetchAllComparables(identity, ad.url, settings, log);
    const lbcCount = comparables.filter((c) => c.source === "lbc").length;
    const laCount = comparables.filter((c) => c.source === "lesanonces").length;
    const carCount = comparables.filter((c) => c.source === "caradisiac").length;
    log(`[comparables:summary] ${comparables.length} total (LBC: ${lbcCount}, LesAnonces: ${laCount}, Caradisiac: ${carCount})`);
    for (const c of comparables.slice(0, 8)) {
      const km = c.kilometrage_km ? `${c.kilometrage_km}km` : "?km";
      const yr = c.annee || "?";
      log(`  • [${(c.source || "?").toUpperCase()}] ${c.price_eur}€ ${yr} ${km} — ${(c.subject || "").slice(0, 60)}`);
    }
  } catch (e) { log(`[comparables:error] ${e.message}`); }
  phase("comparables_done", { count: comparables.length, comparables });
  progress(0.85, "Comparables collectés");

  // 4) Synthese
  phase("synth_start");
  progress(0.87, "Synthèse IA");
  const askingPrice = ad.price ? Number(ad.price) : null;
  log(`[synth:start] model=${settings.ollamaSynthModel || "(nano/webllm)"}`);
  let synth = null;
  try {
    synth = await llm.json({
      system: "Tu es un expert prudent du marche auto d'occasion en France. Tu reponds uniquement en JSON strict, en francais.",
      prompt: buildSynthesisPrompt(adText, identity, priceSummary, askingPrice, comparables, reliability),
      model: settings.ollamaSynthModel,
      schema: SYNTHESIS_SCHEMA,
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
      finition: identity.finition || null,
      year: identity.annee || null,
      motorisation: identity.motorisation || null,
      energie: identity.energie || null,
      boite: identity.boite || null,
      kilometrage_km: identity.kilometrage_km || null,
      msrp_eur: priceSummary.estimate.msrp_eur || null,
      retail_eur: priceSummary.estimate.retail_eur || null,
      retail_source: null,
      condition_score: 60,
      estimated_market_eur: priceSummary.estimate.used_eur || (priceSummary.estimate.msrp_eur ? priceSummary.estimate.msrp_eur * decoteFactor(identity.annee, { brand: identity.marque, kilometrage_km: identity.kilometrage_km }) : 0),
      deal_score: 50,
      reasoning: "Synthese LLM indisponible. Estimation base sur les comparables et les signaux web.",
      pros: [],
      cons: ["Pas de synthese IA disponible"],
      must_check: [],
    };
  }

  // Score deal deterministe
  const allPrices = comparables.filter((c) => c.price_eur).map((c) => c.price_eur);
  const medianComparables = median(allPrices);
  const hasComparables = allPrices.length >= 3;
  const hasWebPrice = !!(priceSummary.estimate.msrp_eur || priceSummary.estimate.retail_eur);
  const scores = computeAutoDealScores({
    asking: askingPrice,
    msrp: synth.msrp_eur,
    retail: synth.retail_eur,
    year: synth.year,
    brand: synth.brand,
    kilometrage_km: synth.kilometrage_km,
    energie: synth.energie,
    medianComparables,
    comparablesCount: allPrices.length,
  });
  if (scores.deal_score != null && (hasComparables || hasWebPrice)) {
    log(`[deal:override] LLM=${synth.deal_score} → déterministe=${scores.deal_score}`);
    synth.deal_score = scores.deal_score;
  }

  // Si on a des must_check sourcés (fiabilité web multi-source), ils priment
  // sur ceux générés par Nano (qui peut halluciner FAP/chaine sur des moteurs
  // qui n'en portent pas). On garde ceux de Nano en complément seulement.
  if (reliability?.must_check?.length) {
    const sourced = reliability.must_check.map((s) => s.trim()).filter(Boolean);
    const sourcedLower = new Set(sourced.map((s) => s.toLowerCase()));
    const llmExtras = (synth.must_check || [])
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !sourcedLower.has(s.toLowerCase()));
    // Filet anti-hallucination : on rejette les must_check du LLM qui mentionnent
    // FAP/EGR/chaine si la fiabilité web ne les a pas confirmés (= pas de signal
    // technique sur cette motorisation).
    const sourcedConcat = sourced.join(" ").toLowerCase();
    const filteredLlm = llmExtras.filter((s) => {
      const sLow = s.toLowerCase();
      const mentionsFap = /\bfap\b/.test(sLow);
      const mentionsEgr = /\begr\b/.test(sLow);
      const mentionsChain = /(cha[iî]ne de distribution)/.test(sLow);
      const mentionsBelt = /(courroie de distribution|courroie d'accessoires)/.test(sLow);
      if (mentionsFap && !sourcedConcat.includes("fap")) return false;
      if (mentionsEgr && !sourcedConcat.includes("egr")) return false;
      if (mentionsChain && !sourcedConcat.match(/cha[iî]ne/)) return false;
      if (mentionsBelt && !sourcedConcat.match(/courroie/)) return false;
      return true;
    });
    const dropped = llmExtras.length - filteredLlm.length;
    if (dropped) log(`[must_check:filter] ${dropped} must_check LLM dropped (mentions techniques non confirmees par fiabilite web)`);
    synth.must_check = [...sourced, ...filteredLlm].slice(0, 6);
    log(`[must_check:merged] ${synth.must_check.length} (${sourced.length} sourcés + ${filteredLlm.length} LLM)`);
  } else {
    // Pas de fiabilite web : on filtre quand meme les hallucinations evidentes
    // selon l'annee/motorisation/energie.
    const synthMc = synth.must_check || [];
    const yr = synth.year || identity.annee;
    const energie = synth.energie || identity.energie;
    const filtered = synthMc.filter((s) => {
      const sLow = s.toLowerCase();
      // Pas de FAP avant 2008-2009 (norme Euro 5)
      if (/\bfap\b/.test(sLow) && yr && yr < 2009) return false;
      // Pas de FAP sur essence
      if (/\bfap\b/.test(sLow) && energie === "essence") return false;
      // Pas de pannes diesel-specifiques sur essence
      if (energie === "essence" && /\b(injecteurs?\s+(?:diesel|hdi|tdi|dci)|vanne\s+egr|cha[iî]ne\s+de\s+distribution\s+diesel)\b/.test(sLow)) return false;
      return true;
    });
    if (filtered.length !== synthMc.length) {
      log(`[must_check:filter:no-source] ${synthMc.length - filtered.length} must_check LLM dropped (FAP pre-2009 ou essence ou diesel-specific sur essence)`);
      synth.must_check = filtered;
    }
  }

  // Override estimated_market_eur par mediane si >= 3 comparables
  if (allPrices.length >= 3 && medianComparables) {
    if (Math.abs(medianComparables - synth.estimated_market_eur) > medianComparables * 0.05) {
      log(`[market:override] LLM=${synth.estimated_market_eur}€ → mediane=${Math.round(medianComparables)}€`);
      synth.estimated_market_eur = Math.round(medianComparables);
    }
  }

  // Sources clickables
  function isValidSourceUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url);
      if (u.hostname.endsWith("bing.com") && u.pathname.includes("/ck/a")) return false;
      if (/(?:^|\.)(?:bing|google|duckduckgo|qwant)\.[a-z]+/.test(u.hostname)) return false;
      return ["http:", "https:"].includes(u.protocol);
    } catch { return false; }
  }
  function findFirstSource(kinds) {
    for (const k of kinds) {
      const arr = priceSummary.by_kind?.[k] || [];
      const valid = arr.find((p) => isValidSourceUrl(p.source));
      if (valid) return { url: valid.source, name: valid.source_name };
    }
    return null;
  }
  const msrpSource = findFirstSource(["msrp"]);
  const retailSource = findFirstSource(["retail", "current", "sale"]);
  const usedSource = findFirstSource(["used"]);
  if (msrpSource) synth.msrp_source_url = msrpSource.url;
  if (synth.retail_source) {
    const lowSrc = synth.retail_source.toLowerCase();
    if (/lbc|leboncoin|troc|lesanonces|caradisiac|comparable/.test(lowSrc)) {
      log(`[retail:hallucine] retail_source="${synth.retail_source}" depuis comparable, on nettoie`);
      synth.retail_eur = null;
      synth.retail_source = null;
    }
  }
  if (retailSource) {
    synth.retail_source_url = retailSource.url;
    if (!synth.retail_source && retailSource.name) synth.retail_source = retailSource.name;
  }
  if (usedSource) synth.used_source_url = usedSource.url;

  // Attache la fiabilite a synth pour l'overlay
  if (reliability) synth.reliability = reliability;

  const result = {
    category: "voiture",
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
        url: r.url, title: r.title, source_name: r.source_name,
        prices: r.prices_in_page || [],
        has_reliability: !!r.reliability_in_page,
      })),
      comparables_count: comparables.length,
      comparables_median_eur: medianComparables ? Math.round(medianComparables) : null,
      comparables_samples: comparables.slice(0, 10),
      reliability_sources: reliabilityReports.length,
      deal_scores: scores,
      backend: llm.backend?.kind,
    },
  };
  log(`[done] ${((Date.now() - t0) / 1000).toFixed(1)}s — deal_score=${synth.deal_score} estimated_market=${synth.estimated_market_eur}€`);
  progress(1.0, "Analyse terminée");
  phase("done", { result });
  return result;
}

// ─── Module categorie ────────────────────────────────────────────────

export default {
  id: "voiture",
  label: "Voiture",
  detect,
  enrichAd,
  uiRendererPath: "lib/categories/voiture/ui.js",
};

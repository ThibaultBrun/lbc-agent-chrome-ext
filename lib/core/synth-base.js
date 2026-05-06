// Helpers déterministes utiles à toute catégorie : ratio→score, deal score combiné,
// summarize_prices (regroupe les prix web en MSRP/retail/used).
// Les règles de décote spécifiques (ex: VTT par âge) restent dans la catégorie.

import { median } from "./utils.js";

// Mappe un ratio prix_demandé / prix_marché vers un score 0-100 (cohérent avec
// la sortie LLM des règles bike-ia-agent).
export function ratioToScore(r) {
  if (r >= 1.5) return 0;
  if (r >= 1.25) return 15;
  if (r >= 1.1) return 30;
  if (r >= 0.95) return 50;
  if (r >= 0.85) return 65;
  if (r >= 0.7) return 80;
  if (r >= 0.55) return 90;
  return 95;
}

export function computeDealScore(asking, market) {
  if (asking == null || !market || market <= 0) return null;
  return ratioToScore(asking / market);
}

// Combinaison deal_score basée sur deux signaux :
// - marketFromNew : prix neuf décoté (objectif, calculable)
// - marketFromUsedTier / marketFromUsedGlobal : médiane comparables (terrain)
//
// Pondération adaptative selon la fiabilité des signaux :
// - Pas de comparables → 100% marketFromNew (s'il existe)
// - 1-2 comparables → 60% new / 40% used (peu fiable côté terrain)
// - 3-9 comparables → 50% new / 50% used
// - 10+ comparables → 25% new / 75% used (signal terrain ultra-robuste)
//
// Sanity check : si marketFromNew donne un chiffre tres different de la mediane
// comparables (>2x ou <0.5x), c'est qu'on a probablement un MSRP halluciné ou
// une decote inadaptee. On ignore alors marketFromNew, le signal terrain prime.
export function combineDealScores({ asking, marketFromNew, marketFromUsedTier, marketFromUsedGlobal, comparablesCount = 0 }) {
  let marketFromUsed, usedBasis;
  if (marketFromUsedTier) { marketFromUsed = marketFromUsedTier; usedBasis = "tier_match"; }
  else if (marketFromUsedGlobal) { marketFromUsed = marketFromUsedGlobal; usedBasis = "global_fallback"; }
  else { marketFromUsed = null; usedBasis = "none"; }

  // Sanity check : marketFromNew incoherent avec le signal terrain ?
  // Si on a >=3 comparables, ils sont la verite terrain. Si marketFromNew s'en
  // ecarte trop (>1.7x ou <0.65x), c'est que la decote theorique est mal
  // calibree (MSRP halluciné, age inconnu, modele atypique). On l'ignore.
  let usedNew = marketFromNew;
  let newDropped = false;
  if (marketFromNew && marketFromUsed && comparablesCount >= 3) {
    const ratio = marketFromNew / marketFromUsed;
    if (ratio > 1.7 || ratio < 0.65) {
      usedNew = null;
      newDropped = true;
    }
  }

  const scoreVsNew = computeDealScore(asking, usedNew);
  const scoreVsUsed = computeDealScore(asking, marketFromUsed);

  // Pondération adaptative
  let weightUsed;
  if (comparablesCount >= 10) weightUsed = 0.75;
  else if (comparablesCount >= 3) weightUsed = 0.5;
  else if (comparablesCount >= 1) weightUsed = 0.4;
  else weightUsed = 0;
  const weightNew = 1 - weightUsed;

  let final;
  if (scoreVsNew != null && scoreVsUsed != null) {
    final = Math.round(weightNew * scoreVsNew + weightUsed * scoreVsUsed);
  } else if (scoreVsUsed != null) {
    final = scoreVsUsed;
  } else if (scoreVsNew != null) {
    final = scoreVsNew;
  } else {
    final = null;
  }

  return {
    deal_score: final,
    deal_score_vs_new: scoreVsNew,
    deal_score_vs_used: scoreVsUsed,
    market_from_new_eur: usedNew ? Math.round(usedNew) : null,
    market_from_used_eur: marketFromUsed ? Math.round(marketFromUsed) : null,
    used_basis: usedBasis,
    new_dropped: newDropped,
    weight_used: weightUsed,
  };
}

// Résumé des prix collectés sur le web : groupe par kind + estimateurs (médiane).
export function summarizePrices(results) {
  const all = [];
  for (const r of results) {
    for (const key of ["prices_in_result", "prices_in_page"]) {
      for (const p of (r[key] || [])) {
        all.push({
          amount_eur: p.amount_eur,
          kind: p.kind || "unknown",
          context: p.context || p.raw || "",
          source: r.url,
          source_title: r.title,
          source_name: r.source_name || "Autre",
          source_domain: r.source_domain,
          source_priority: r.source_priority || 999,
        });
      }
    }
  }
  if (!all.length) return { count: 0, by_kind: { msrp: [], retail: [], current: [], used: [], sale: [], unknown: [] }, estimate: { msrp_eur: null, retail_eur: null, used_eur: null } };

  const sorted = all.slice().sort((a, b) => (a.source_priority - b.source_priority) || (a.amount_eur - b.amount_eur));
  const seen = new Set();
  const unique = [];
  for (const p of sorted) {
    const k = `${p.amount_eur}|${p.kind}|${p.source}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(p);
  }
  const byKind = { msrp: [], retail: [], current: [], used: [], sale: [], unknown: [] };
  for (const p of unique) (byKind[p.kind in byKind ? p.kind : "unknown"]).push(p);

  return {
    count: unique.length,
    by_kind: {
      msrp: byKind.msrp.slice(0, 10),
      retail: byKind.retail.slice(0, 10),
      current: byKind.current.slice(0, 10),
      used: byKind.used.slice(0, 10),
      sale: byKind.sale.slice(0, 5),
      unknown: byKind.unknown.slice(0, 10),
    },
    estimate: {
      msrp_eur: median(byKind.msrp.map((p) => p.amount_eur)),
      retail_eur: median([...byKind.retail, ...byKind.current].map((p) => p.amount_eur)),
      used_eur: median([...byKind.used, ...byKind.sale].map((p) => p.amount_eur)),
    },
  };
}

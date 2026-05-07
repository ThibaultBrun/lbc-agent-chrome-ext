// Synthese voiture : DECOTE_RULES_AUTO + SYNTHESIS_SCHEMA + buildSynthesisPrompt + decote 2D.
// Specificite auto : le KILOMETRAGE compte plus que l'age dans la cote.

import { CURRENT_YEAR_AUTO } from "./catalog.js";
import { median } from "../../core/utils.js";
import { combineDealScores } from "../../core/synth-base.js";

export const DECOTE_RULES_AUTO = `
DECOTE VOITURE OCCASION (% du prix neuf catalogue) — modele 2D age + kilometrage :

DECOTE PAR AGE (base) :
- < 1 an   : 80-90% (perte de la TVA + carte grise)
- 1-3 ans  : 60-75%
- 3-6 ans  : 40-55%
- 6-10 ans : 20-35%
- 10-15 ans: 12-22%
- > 15 ans : 5-15% (sauf ancetre/collection : peut remonter)

PENALITE KILOMETRAGE (par rapport a la moyenne 15000 km/an) :
- < 50% du km moyen     : +10 a +20% sur la cote (peu roule, recherche)
- entre 50% et 150%     : neutre
- entre 150% et 250%    : -10 a -20% (gros rouleur)
- > 250% (ex 200k a 5 ans) : -25 a -40% (mefiance)

CAS PARTICULIERS :
- Marques premium (BMW, Audi, Mercedes, Volvo, Jaguar) : decote initiale plus forte
  les 3 premieres annees, puis se stabilise. Total ~ -10% par rapport au tableau.
- Marques generalistes premium (Peugeot, Renault haut de gamme) : suivent table standard.
- Marques low-cost (Dacia, Suzuki, Kia anciens) : decote MOINS forte (cote stable),
  +10% par rapport au tableau (ex Dacia 5 ans = 50-60% au lieu de 40-55%).
- Tesla / EV : decote tres erratique selon evolution autonomie/prix neuf. Mefiance, signal
  marche prime sur calcul theorique.
- Voitures sportives / collection (M3, RS, GTI populaires, ancetres) : decote arrete
  apres 7-8 ans, peut MEME remonter (cote ascendante).

PENALITES TECHNIQUES (cumulables) :
- Boite robotisee fragile connue (DSG7 dry, EDC, MultiAir auto) : -10%
- Diesel apres ZFE (vignette Crit'Air 3+) : -15 a -25% sur les agglos concernees
- 1.6 HDi e-HDi connu pour pannes (FAP, vanne EGR, injecteurs) : -10%
- Distribution courroie depassee sans facture : -10%
- Boite manuelle vs auto (selon modele) : marche manuelle souvent +5% en France
- Premiere main avec carnet : +5 a +10%
- Plus de 3 proprietaires : -5 a -10%
- CT a refaire imminent : -5%

FIABILITE & PANNES CONNUES :
Si une motorisation est connue pour des pannes graves (chaine de distribution
qui casse, joint de culasse, FAP HS, EGR), penaliser de -10 a -20% en cons et
faire un must_check explicite. Ne pas baisser le deal_score pour autant : c'est
un facteur RISQUE pas un facteur PRIX MARCHE (le marche le price-tag deja).

condition_score (0-100) :
- 0=epave / 30=tres use, kms eleve / 50=usure normale / 80=bon etat / 95+=quasi neuf

deal_score (0-100) :
- 0=tres cher / 30=un peu cher / 50=au marche / 70=sous marche -15 a -30% / 90+=>-30%
- Si prix demande inconnu : deal_score = 50 (neutre).
- REGLE : ne PAS baisser le deal_score pour pannes connues — elles sont deja dans le
  prix marche. Mettre les risques dans cons + must_check.

DEUX prix neufs distincts :
- msrp_eur = prix CATALOGUE constructeur a la sortie du modele (RRP).
- retail_eur = prix NEUF actuel chez mandataire (Aramis, Promo Neuve...).
  Souvent retail < msrp grace aux remises constructeur.

PRIORITE pour estimated_market_eur :
1. Mediane comparables LBC + LesAnonces + Caradisiac avec annee/km/finition similaires (>=3 ads). TRES fiable.
2. Cote Argus / La Centrale pour ce profil exact.
3. msrp_eur * decote selon age * facteur kilometrage. Calculable.
4. Mediane comparables globale (sans filtre annee). Moyennement fiable.
`;

export const SYNTHESIS_SCHEMA = {
  type: "object",
  properties: {
    brand: { type: ["string", "null"] },
    model: { type: ["string", "null"] },
    finition: { type: ["string", "null"] },
    year: { type: ["integer", "null"] },
    motorisation: { type: ["string", "null"] },
    energie: { type: ["string", "null"], enum: ["essence", "diesel", "hybride", "hybride rechargeable", "electrique", "gpl", "ethanol", null] },
    boite: { type: ["string", "null"], enum: ["manuelle", "automatique", "robotisee", "semi-automatique", null] },
    kilometrage_km: { type: ["integer", "null"] },
    msrp_eur: { type: ["number", "null"], minimum: 0 },
    retail_eur: { type: ["number", "null"], minimum: 0 },
    retail_source: { type: ["string", "null"] },
    condition_score: { type: "integer", minimum: 0, maximum: 100 },
    estimated_market_eur: { type: "number", minimum: 0 },
    deal_score: { type: "integer", minimum: 0, maximum: 100 },
    reasoning: { type: "string", maxLength: 1500 },
    pros: { type: "array", items: { type: "string", maxLength: 100 }, maxItems: 4 },
    cons: { type: "array", items: { type: "string", maxLength: 100 }, maxItems: 4 },
    must_check: { type: "array", items: { type: "string", maxLength: 150 }, maxItems: 5 },
  },
  required: [
    "brand", "model", "year", "energie", "kilometrage_km",
    "msrp_eur", "retail_eur",
    "condition_score", "estimated_market_eur", "deal_score",
    "reasoning", "pros", "cons", "must_check",
  ],
  additionalProperties: false,
};

export function buildSynthesisPrompt(annonceText, identity, priceSummary, askingPrice, comparables = [], reliability = null) {
  let text = annonceText || "";
  if (text.length > 2500) text = text.slice(0, 2500) + "...";

  const estimate = priceSummary?.estimate || {};
  const msrp = estimate.msrp_eur;
  const retailWeb = estimate.retail_eur;
  const usedMarketWeb = estimate.used_eur;

  const byKind = priceSummary?.by_kind || {};
  const samples = [];
  for (const kind of ["msrp", "retail", "current", "used", "sale"]) {
    for (const p of (byKind[kind] || []).slice(0, 3)) {
      samples.push(`  - ${kind}: ${p.amount_eur} EUR (${p.source_name || "?"})`);
    }
  }
  const samplesBlock = samples.length ? samples.join("\n") : "  (aucun)";

  const allPrices = comparables.filter((c) => c.price_eur).map((c) => c.price_eur);
  const medAll = median(allPrices);

  let comparablesBlock = "  (aucun comparable)";
  if (allPrices.length) {
    const lines = [`  - mediane sur ${allPrices.length} comparables : ${Math.round(medAll)} EUR`];
    if (allPrices.length >= 3) lines.push("  -> SIGNAL TERRAIN FIABLE pour estimated_market_eur");
    lines.push("  - echantillons :");
    for (const c of comparables.slice(0, 8)) {
      const km = c.kilometrage_km ? `${c.kilometrage_km} km` : "?km";
      const yr = c.annee ? c.annee : "?";
      lines.push(`    * [${(c.source || "?").toUpperCase()}] ${c.price_eur}€ — ${yr} — ${km} — ${(c.subject || "").slice(0, 60)}`);
    }
    comparablesBlock = lines.join("\n");
  }

  // Bloc fiabilite si dispo
  let reliabilityBlock = "";
  if (reliability) {
    const reLines = [];
    if (reliability.reliability_score != null) reLines.push(`  - score: ${reliability.reliability_score}/100`);
    if (reliability.consensus) reLines.push(`  - consensus: ${reliability.consensus}`);
    if (reliability.risky_period) reLines.push(`  - periode a risque: ${reliability.risky_period}`);
    if (reliability.known_issues?.length) {
      reLines.push("  - pannes connues :");
      for (const iss of reliability.known_issues.slice(0, 6)) {
        const sev = iss.severity ? `[${iss.severity}]` : "";
        const freq = iss.frequency ? `(${iss.frequency})` : "";
        reLines.push(`    * ${iss.part} ${sev}${freq}: ${iss.description || ""} ${iss.symptoms ? "— " + iss.symptoms : ""}`);
      }
    }
    if (reliability.must_check?.length) {
      reLines.push("  - a verifier obligatoirement :");
      for (const mc of reliability.must_check) reLines.push(`    * ${mc}`);
    }
    reliabilityBlock = `\nFIABILITE / PANNES CONNUES (recherche web) :\n${reLines.join("\n")}\n`;
  }

  const decoteContext = identity?.annee
    ? `\nContexte decote :
- Age : ${CURRENT_YEAR_AUTO - identity.annee} ans
- Kilometrage : ${identity.kilometrage_km || "inconnu"} km (moyenne attendue : ${(CURRENT_YEAR_AUTO - identity.annee) * 15000} km a 15 000 km/an)
`
    : "";

  return `Annonce :
${text}

Identite extraite (extracteur LLM, peut etre incomplete) :
${JSON.stringify(identity, null, 2)}

Prix demande dans l'annonce : ${askingPrice ? `${askingPrice} EUR` : "inconnu"}
${decoteContext}
Comparables actuels (Leboncoin, LesAnonces, Caradisiac) :
${comparablesBlock}

Resultats catalogue / cote (recherche web) :
- MSRP constructeur : ${msrp || "inconnu"} EUR
- Prix neuf mandataire (Aramis, Promo Neuve, etc.) : ${retailWeb || "inconnu"} EUR
- Prix occasion web (cote Argus, La Centrale) : ${usedMarketWeb || "inconnu"} EUR
- Echantillons :
${samplesBlock}
${reliabilityBlock}
REGLES :
${DECOTE_RULES_AUTO}

TACHE : remplis TOUS les champs du schema.
1. brand/model/finition/year/motorisation/energie/boite/kilometrage_km : copie/corrige depuis l'identite.
2. msrp_eur : prix CATALOGUE constructeur a la sortie du modele. Provient des signaux msrp web ou ta connaissance.
   JAMAIS depuis les comparables LBC/LesAnonces/Caradisiac (ce sont des occasions). null si inconnu.
3. retail_eur : prix NEUF actuel chez mandataire (Aramis, Promo Neuve, Auto IES...). Provient des signaux 'retail' web UNIQUEMENT.
   JAMAIS depuis les comparables d'occasion. JAMAIS retail_source = 'LBC'/'Leboncoin'/'LesAnonces'.
4. estimated_market_eur : prix REVENTE occasion. Mediane comparables avec annee/km similaires en priorite.
5. condition_score (0-100) depuis le texte ('tres bon etat' ~80, 'comme neuf' 90+, 'a debattre' / usure mentionnee 50-60).
6. deal_score (0-100) : ecart prix demande vs estimated_market_eur. 50 si prix inconnu.
7. reasoning : 2-3 phrases (~200 mots max).
8. pros : 2-4 bullets. Points concrets sur le vehicule precis (peu de km, 1ere main, options, etat).
9. cons : 2-4 bullets. INTERDIT :
   - speculation arnaque, ville/date
   - mention de l'absence de signal web / de comparables / de donnees marche
   - paraphrase des regles du prompt
   Mentionner : kilometrage eleve, pannes connues sur cette motorisation, CT a faire,
   plusieurs proprietaires, modele ZFE Crit'Air 3+...
10. must_check : 2-5 bullets ACTIONNABLES pour l'acheteur lors de l'essai.

   REGLE CRITIQUE : ne pas inventer des verifications generiques diesel/essence !
   Chaque element doit etre :
   (a) issu du bloc FIABILITE/PANNES CONNUES ci-dessus quand il est rempli
       (re-utilise les must_check qui y sont listes), OU
   (b) base sur une faiblesse TECHNIQUE CONNUE de cette motorisation precise
       (ne pas mettre 'verifier FAP' sur un diesel pre-2008 qui n'en a pas,
       ne pas mettre 'chaine de distribution' sur un moteur a courroie, etc.), OU
   (c) un controle generique applicable a TOUTES les voitures d'occasion :
       historique entretien, factures, CT a jour, kilometrage coherent, geometrie/
       freins, embrayage (si manuelle).

   INTERDIT :
   - 'Controler le FAP' si l'annee/motorisation ne porte pas de FAP
   - 'Verifier la chaine de distribution' si le moteur a une COURROIE de distribution
     (ex: la majorite des PSA HDi anciens, Renault dCi <2008)
   - Toute verification d'une piece qui n'existe PAS sur cette motorisation
   - Liste fourre-tout de pannes diesel generiques alors qu'on n'a aucune info
     specifique sur ce moteur

   Si tu n'as pas d'info technique fiable pour la motorisation cible, mets
   uniquement les controles generiques (c) — pas plus de 2-3 elements. Mieux
   vaut 2 must_check pertinents que 5 generiques avec un risque d'erreur.

REPONSE EN FRANCAIS UNIQUEMENT, JSON STRICT conforme au schema.`;
}

// ─── Decote 2D : age + kilometrage ────────────────────────────────────

// Decote par age (auto = decote plus forte que velo, surtout les premieres annees)
function ageDecote(age) {
  if (age < 1) return 0.85;
  if (age < 3) return 0.68;
  if (age < 6) return 0.48;
  if (age < 10) return 0.28;
  if (age < 15) return 0.17;
  return 0.10;
}

// Penalite kilometrage : ratio km / km_attendu (15000 km/an)
function kmFactor(km, age) {
  if (!km || !age || age <= 0) return 1.0;
  const expected = age * 15000;
  if (expected <= 0) return 1.0;
  const ratio = km / expected;
  if (ratio < 0.5) return 1.15;       // tres peu roule
  if (ratio < 0.8) return 1.05;
  if (ratio < 1.2) return 1.0;        // moyen
  if (ratio < 1.5) return 0.92;
  if (ratio < 2.0) return 0.82;
  if (ratio < 2.5) return 0.72;
  return 0.62;                        // tres gros rouleur
}

// Bonus / malus marque
function brandFactor(brand) {
  if (!brand) return 1.0;
  const b = String(brand).toLowerCase();
  // Premium : decote plus forte les 3 premieres annees, ici on simplifie a -5%
  if (/bmw|audi|mercedes|volvo|jaguar|land rover|porsche|tesla/.test(b)) return 0.95;
  // Low-cost : cote plus stable
  if (/dacia|suzuki/.test(b)) return 1.10;
  return 1.0;
}

export function decoteFactor(year, opts = {}) {
  if (!year) return 0.4;
  const age = Math.max(0, CURRENT_YEAR_AUTO - parseInt(year, 10));
  const base = ageDecote(age);
  const km = kmFactor(opts.kilometrage_km, age);
  const brand = brandFactor(opts.brand);
  return Math.max(0.05, Math.min(1.0, base * km * brand));
}

export function computeMarketFromNew(msrp, retail, year, opts = {}) {
  // Sanity check : retail < msrp * 0.6 = LLM a probablement classe une occasion
  // en retail. Auto : les remises mandataire vont jusqu'a -25% sur du neuf, donc
  // seuil legerement plus permissif que velo.
  let newPrice;
  if (msrp && retail && retail < msrp * 0.6) {
    newPrice = msrp;
  } else {
    newPrice = retail || msrp;
  }
  if (!newPrice || newPrice <= 0) return null;
  return newPrice * decoteFactor(year, opts);
}

export function computeAutoDealScores({
  asking, msrp, retail, year, brand, kilometrage_km, energie,
  medianComparables, comparablesCount = 0,
}) {
  return combineDealScores({
    asking,
    marketFromNew: computeMarketFromNew(msrp, retail, year, { brand, kilometrage_km, energie }),
    marketFromUsedTier: medianComparables,  // pas de notion de tier auto, on prend la mediane globale
    marketFromUsedGlobal: medianComparables,
    comparablesCount,
  });
}

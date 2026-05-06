// Synthèse vélo : DECOTE_RULES_BIKE + SYNTHESIS_SCHEMA + buildSynthesisPrompt + decote.
// Port fidèle de bike_agent/synth.py.

import { CURRENT_YEAR } from "../../core/config.js";
import { median } from "../../core/utils.js";
import { combineDealScores } from "../../core/synth-base.js";

export const DECOTE_RULES_BIKE = `
DECOTE VTT/velo occasion (% du prix neuf catalogue):
- < 4 ans : 50-70%
- 4-7 ans : 25-40%
- 8-12 ans : 12-22%  (obsolescence techno)
- > 12 ans : 5-15%

VELOS JUNIOR (roues 14-24 pouces) : decote moins forte (usage moins agressif)
- < 4 ans : 60-80%
- 4-7 ans : 35-55%
- > 8 ans : 15-30%

PENALITES (cumulables):
- 26" adulte sur VTT XC/AM/enduro/DH : -40% au moins (standard obsolete depuis ~2015).
  EXCEPTION : VTT DIRT 26" = NORMAL, c'est le standard de la discipline. Pas de penalite.
- axe 9mm / non-Boost : -20% (incompatible standards modernes 110/148mm).
- cassette 9V/10V : -10% (12V est le standard 2018+).
- cadre alu raye / impact : -10 a -20%.
- modele VTT < 2018 : ne PAS surestimer la cote, plafond strict.

CLASSIFICATION vtt_category (par mm de debattement avant/arriere):
- xc            : 80-120mm
- all_mountain  : 120-150mm
- enduro        : 150-170mm
- dh            : 180-200mm
- dirt          : hardtail rigide. TOUJOURS 26".
- null          : non-VTT (route, gravel, ville, junior, BMX)

condition_score (0-100):
- 0=HS / 30=tres use / 50=usure visible / 80=bon etat / 95+=quasi neuf

deal_score (0-100):
- 0=tres cher / 30=un peu cher / 50=au marche / 70=sous marche -15 a -30% / 90+=>-30%
- Si prix demande inconnu : deal_score = 50 (neutre)
- REGLE: ne PAS baisser le deal_score pour suspicion d'arnaque, ex-location, reconditionne (les doutes vont dans cons).
- Si asking_price est franchement sous le marche (-30%+) il faut OSER monter a 85-95.

DEUX prix neufs distincts a remplir:
PRINCIPE GENERAL : ta connaissance des prix peut etre obsolete. Les SIGNAUX WEB sont la verite terrain.

msrp_eur = prix catalogue CONSTRUCTEUR (RRP/MSRP) au lancement du modele.
retail_eur = prix NEUF en boutique chez gros revendeur en ligne (Alltricks, Bike-Discount, Probikeshop, Bike24, Starbike). PRIORITE ABSOLUE aux signaux 'retail' du web. Si pas de signal retail mais un msrp web : retail_eur ≈ msrp * 0.85.
retail_source : nom du revendeur du signal retail le plus pertinent, sinon null.

Plages typiques MSRP :
- VTT enduro carbone haut de gamme : 5000-9000 EUR
- VTT enduro alu mid-range : 2500-4500 EUR
- VTT XC carbone : 4000-8000 EUR
- VAE enduro/AM (Bosch/Shimano EP) : 6000-10000 EUR
- Velo route carbone perf : 3000-12000 EUR
- Velo junior premium 24/26" : 600-1500 EUR

VARIANT TIERS (utile UNIQUEMENT en l'absence de signal web):
- "S-Works" : top historique 11000-15000 EUR.
- "Pro" / "Pro AXS" : haut de gamme 7000-11000 EUR.
- "Expert" : haut milieu 5000-7500 EUR.
- "Comp" : milieu 3500-5500 EUR.
- "Alloy" / "Alu" : entree 2500-4000 EUR.
- "Frameset" : CADRE SEUL.
- "M-Team", "M-LTD" (Orbea) : top series 9000-14000 EUR.

INDICES REVENDEUR / EX-LOCATION (a flagger en CONS sans baisser deal_score):
- "MINT-Bikes", "Buycycle", "Rebike", "Upway", "MyVeloShop" : revendeurs pro de reconditionne.
- Mots cles : "garantie X mois", "reconditionne", "occasion certifiee", "ex-location".

CROSS-CHECK avec connaissance catalogue :
- Orbea Rise H10/H20/H30 = VAE enduro/AM, 29" ou mullet, JAMAIS 26". MSRP 6000-8000 EUR.
- Orbea Rallon = enduro 29", 170mm, MSRP 4000-9000 selon tier.
- Commencal Clash 24 = 24 pouces junior.
- Specialized S-Works = carbone full, jamais alu.
- VAE indices : "EP801", "EP8", "Bosch CX", "540 Wh", "630 Wh" => electric=true, MSRP min 5000-7000 EUR.

REGLE PRIORITAIRE pour estimated_market_eur :
1. Mediane comparables TIER-MATCH (>=3 ads exact meme tier H10/H30/S-Works/etc.) — TRES fiable.
2. msrp_eur * decote selon annee — fiable, calculable.
3. retail_eur web * decote.
4. Mediane comparables GLOBALE — NON FIABLE si peu de tier-match.
`;

export const SYNTHESIS_SCHEMA = {
  type: "object",
  properties: {
    brand: { type: ["string", "null"] },
    model: { type: ["string", "null"] },
    year: { type: ["integer", "null"] },
    frame_material: { type: ["string", "null"] },
    wheel_size: { type: ["string", "null"] },
    electric: { type: ["boolean", "null"] },
    size_label: { type: ["string", "null"] },
    vtt_category: { type: ["string", "null"], enum: ["xc", "all_mountain", "enduro", "dh", "dirt", null] },
    msrp_eur: { type: ["number", "null"], minimum: 0 },
    retail_eur: { type: ["number", "null"], minimum: 0 },
    retail_source: { type: ["string", "null"] },
    condition_score: { type: "integer", minimum: 0, maximum: 100 },
    estimated_market_eur: { type: "number", minimum: 0 },
    deal_score: { type: "integer", minimum: 0, maximum: 100 },
    reasoning: { type: "string", maxLength: 1500 },
    pros: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 4 },
    cons: { type: "array", items: { type: "string", maxLength: 80 }, maxItems: 4 },
  },
  required: [
    "brand", "model", "year", "electric",
    "frame_material", "wheel_size", "size_label", "vtt_category",
    "msrp_eur", "retail_eur", "retail_source",
    "condition_score", "estimated_market_eur", "deal_score",
    "reasoning", "pros", "cons",
  ],
  additionalProperties: false,
};

export function buildSynthesisPrompt(annonceText, identity, priceSummary, askingPrice, comparables = []) {
  let text = annonceText || "";
  if (text.length > 2500) text = text.slice(0, 2500) + "...";

  const estimate = priceSummary?.estimate || {};
  const msrp = estimate.msrp_eur;
  const retailWeb = estimate.retail_eur;
  const usedMarketWeb = estimate.used_eur;
  const hasAnySignal = !!(msrp || retailWeb || usedMarketWeb || comparables.length);

  const fewSignalsWarning = hasAnySignal ? "" : `
ATTENTION: AUCUN SIGNAL WEB NI COMPARABLE n'a ete trouve pour ce velo. Tu ne peux te baser
QUE sur ta connaissance catalogue. Sois TRES PRUDENT :
- Si tu connais ce modele avec certitude : utilise les fourchettes typiques (cf REGLES).
- Pour un VAE/VTTAE 2022+, le MSRP est typiquement 5000-10000 EUR (jamais < 4000).
- Pour un VAE haut de gamme connu (Orbea Wild, Specialized Levo, Trek Rail, Scott Patron),
  MSRP 7000-10000 EUR est la norme.
- Si tu n'es pas sur, mets msrp_eur = null et retail_eur = null PLUTOT que d'inventer.
- estimated_market_eur peut etre estime a partir du prix demande +/- 20% si on n'a vraiment rien.
`;

  const byKind = priceSummary?.by_kind || {};
  const samples = [];
  for (const kind of ["msrp", "retail", "current", "used", "sale"]) {
    for (const p of (byKind[kind] || []).slice(0, 3)) {
      samples.push(`  - ${kind}: ${p.amount_eur} EUR (${p.source_name || "?"})`);
    }
  }
  const samplesBlock = samples.length ? samples.join("\n") : "  (aucun)";

  const allPrices = comparables.filter((c) => c.price_eur).map((c) => c.price_eur);
  const tierPrices = comparables.filter((c) => c.price_eur && c.tier_match === true).map((c) => c.price_eur);
  const medAll = median(allPrices);
  const medTier = median(tierPrices);

  let comparablesBlock = "  (aucun comparable)";
  if (allPrices.length) {
    const lines = [];
    if (tierPrices.length >= 3) {
      lines.push(`  - mediane TIER-MATCH (meme version exacte): ${Math.round(medTier)} EUR sur ${tierPrices.length} ads`);
      lines.push("  -> SIGNAL FIABLE pour estimated_market_eur.");
    } else {
      lines.push(`  - ${allPrices.length} ads similaires trouves (${tierPrices.length} exactement du meme tier)`);
      lines.push("  ATTENTION: pas assez de comparables EXACTEMENT du meme tier (besoin >=3).");
      lines.push("  -> IGNORE les prix ci-dessous, ils concernent d'autres tiers.");
      lines.push("  -> Calcule estimated_market_eur a partir de msrp_eur * decote selon annee.");
    }
    lines.push("  - echantillons (T = tier-match, - = autre tier, source = LBC ou TROC):");
    for (const c of comparables.slice(0, 8)) {
      const tag = c.tier_match === true ? "T" : "-";
      const src = (c.source || "?").toUpperCase();
      lines.push(`    * [${tag}][${src}] ${c.price_eur} EUR — ${(c.subject || "").slice(0, 80)}`);
    }
    comparablesBlock = lines.join("\n");
  }

  return `Annonce :
${text}

Identite extraite (extracteur LLM, peut etre incomplete) :
${JSON.stringify(identity, null, 2)}

Prix demande dans l'annonce : ${askingPrice ? `${askingPrice} EUR` : "inconnu"}

Comparables actuels (Leboncoin + Troc Velo, ads similaires) — le PLUS FIABLE pour le marche occasion :
${comparablesBlock}

Resultats catalogue (recherche web) :
- MSRP constructeur (mediane signaux 'msrp') : ${msrp || "inconnu"} EUR
- Prix neuf revendeur (mediane signaux 'retail'+'current') : ${retailWeb || "inconnu"} EUR
- Prix occasion web (mediane 'used'+'sale') : ${usedMarketWeb || "inconnu"} EUR
- Echantillons :
${samplesBlock}

REGLES :
${DECOTE_RULES_BIKE}
${fewSignalsWarning}
TACHE : remplis TOUS les champs du schema.
1. brand/model/year : copie/corrige depuis l'identite.
2. frame_material, wheel_size, electric, size_label : extrait, cross-check connaissance modele.
3. vtt_category : enum (xc/all_mountain/enduro/dh/dirt) seulement si VTT, sinon null.
4. msrp_eur : prix CATALOGUE constructeur (RRP).
5. retail_eur : prix NEUF en boutique. retail_source : nom revendeur source ou null.
6. estimated_market_eur : prix REVENTE occasion. Mediane tier-match en priorite, sinon msrp * decote.
7. condition_score (0-100) depuis le texte ("tres bon etat" ~80, "neuf" 95+).
8. deal_score (0-100) : ecart prix demande vs estimated_market_eur. 50 si prix inconnu.
9. reasoning : 2-3 phrases (~200 mots max).
10. pros : 2-4 bullets concis (max ~10 mots/item). Points substantiels uniquement.
11. cons : 2-4 bullets concis. INTERDIT : speculation arnaque, ville/date.

REPONSE EN FRANCAIS UNIQUEMENT, JSON STRICT conforme au schema.`;
}

// ─── Décote spécifique vélo ─────────────────────────────────────────

export function decoteFactor(year) {
  if (!year) return 0.5;
  const age = Math.max(0, CURRENT_YEAR - parseInt(year, 10));
  if (age < 4) return 0.6;
  if (age < 7) return 0.32;
  if (age < 12) return 0.17;
  return 0.1;
}

export function computeMarketFromNew(msrp, retail, year) {
  const newPrice = retail || msrp;
  if (!newPrice || newPrice <= 0) return null;
  return newPrice * decoteFactor(year);
}

// Wrapper qui calcule marketFromNew via decote vélo, puis délègue à core/synth-base.
export function computeBikeDealScores({ asking, msrp, retail, year, lbcMedianTier, lbcMedianGlobal }) {
  return combineDealScores({
    asking,
    marketFromNew: computeMarketFromNew(msrp, retail, year),
    marketFromUsedTier: lbcMedianTier,
    marketFromUsedGlobal: lbcMedianGlobal,
  });
}

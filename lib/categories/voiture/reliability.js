// Extraction de la fiabilite + pannes connues d'un modele + motorisation.
// Tres important en auto : un Peugeot 308 1.6 HDi 110 fiable vs un 308 2.0
// BlueHDi 150 problematique sur la chaine de distribution → meme modele,
// meme annee, mais cote occasion tres differente et risques tres differents.

import { extractPriceContext } from "../../core/pages.js";

export const RELIABILITY_SCHEMA = {
  type: "object",
  properties: {
    // Score global de fiabilite (0-100). 50 = moyen, 80+ = reference, <40 = mefiance.
    reliability_score: { type: ["integer", "null"], minimum: 0, maximum: 100 },
    // Pannes / faiblesses connues sur ce moteur / cette generation
    known_issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          part: { type: "string", maxLength: 80 },           // "Chaine de distribution", "FAP", "Injecteurs", "Volant moteur bi-masse"
          severity: { type: ["string", "null"], enum: ["mineur", "moyen", "grave", "critique", null] },
          frequency: { type: ["string", "null"], enum: ["rare", "occasionnel", "frequent", "tres_frequent", null] },
          description: { type: ["string", "null"], maxLength: 200 }, // "casse vers 150-200k km"
          symptoms: { type: ["string", "null"], maxLength: 200 },     // "perte de puissance, voyant moteur"
          fix_cost_eur: { type: ["integer", "null"], minimum: 0 },    // coût reparation typique
        },
        required: ["part"],
        additionalProperties: false,
      },
      maxItems: 8,
    },
    // Indicateurs positifs (longevite, robustesse mecanique, etc.)
    strengths: {
      type: "array",
      items: { type: "string", maxLength: 120 },
      maxItems: 5,
    },
    // Points a verifier obligatoirement par l'acheteur sur ce modele/motorisation
    must_check: {
      type: "array",
      items: { type: "string", maxLength: 150 },
      maxItems: 6,
    },
    // Periode de production / motorisation la plus risquee si applicable
    risky_period: { type: ["string", "null"], maxLength: 150 },
    // Source / consensus general
    consensus: { type: ["string", "null"], maxLength: 250 },
  },
  required: ["reliability_score", "known_issues", "strengths", "must_check"],
  additionalProperties: false,
};

export function buildReliabilityExtractionPrompt(identity, pageText, sourceUrl, sourceProfile) {
  const desc = describeIdentity(identity);
  const sname = sourceProfile?.name || "?";
  const sourceTier = classifyReliabilitySource(sourceUrl, sourceProfile);
  const excerpt = extractReliabilityContext(pageText);

  const sourceWarning = {
    pro_specialise: `\nSOURCE TYPE: PROFESSIONNELLE SPECIALISEE (${sname}). Tres fiable, base sur retours
mecaniciens / catalogue de pannes verifie. Les pannes mentionnees sont des
realites techniques. Score base sur les faits techniques, pas sur les avis.`,
    pro_generaliste: `\nSOURCE TYPE: PRESSE AUTO PROFESSIONNELLE (${sname}). Fiable mais peut avoir des
biais commerciaux (annonceurs constructeurs). Privilegie les pannes techniques
documentees, ignore les avis subjectifs ('belle voiture', 'finitions decues').`,
    forum_avis: `\nSOURCE TYPE: FORUM / AVIS UTILISATEURS (${sname}). A prendre avec PRECAUTION :
- Biais affectif : les detracteurs de la marque postent plus que les satisfaits.
- Biais d'echantillon : seuls ceux qui ont eu un probleme ecrivent.
- Une mention isolee de panne ne fait pas une faiblesse modele : il faut une
  recurrence (>3 messages similaires) pour la retenir.
- Les complaints generales ('marque pourrie') sont a IGNORER, on cherche des
  pannes mecaniques precises.
Sois donc PRUDENT : remonte une panne SEULEMENT si elle est mentionnee plusieurs
fois avec des details techniques coherents (km, symptomes, piece precise).`,
    other: `\nSOURCE TYPE: source generaliste (${sname}). Fiabilite intermediaire, applique le
filtre standard.`,
  }[sourceTier];

  return `Voiture cible :
${desc}
Source : ${sourceUrl} (${sname})${sourceWarning}

Voici des extraits d'une page traitant de la fiabilite du modele. Extrais
uniquement les informations qui correspondent a la motorisation et l'annee/
generation cible (pas les autres motorisations du meme modele si elles ne sont
pas mentionnees clairement).

REGLES :
- Tous les champs sont OPTIONNELS. Mets null si l'info n'est pas claire ou
  qu'elle ne correspond pas a la motorisation cible.
- reliability_score : 0-100 sur la base du consensus de la page. Si non explicite,
  estime selon le ton (pannes nombreuses = <50, "moteur reference" = 80+).
- IMPORTANT : ne baisse PAS le score si la source est un forum et que les
  complaints sont vagues / affectives ('peugeot c'est nul'). Cherche des faits
  mecaniques precis.
- known_issues : pannes specifiquement mentionnees pour la motorisation cible.
  - part : nom de la piece (ex: "Chaine de distribution", "FAP", "Injecteurs Bosch CR",
    "Vanne EGR", "Volant moteur bi-masse", "Embrayage", "Turbo", "Pompe a injection")
  - severity : 'mineur' (cosmetique) | 'moyen' (panne sans casse) | 'grave' (immobilise)
    | 'critique' (casse moteur)
  - frequency : 'rare' (<5%) | 'occasionnel' (5-20%) | 'frequent' (20-50%) | 'tres_frequent' (>50%)
  - description : 1 phrase factuelle ("casse typique entre 150 et 200k km")
  - symptoms : 1 phrase ("perte de puissance, fumee bleue, voyant moteur")
  - fix_cost_eur : cout typique de reparation en euros (entier), null si inconnu
- strengths : points forts mecaniques connus ("moteur robuste", "boite manuelle fiable")
- must_check : checklist concrete pour l'acheteur ("verifier l'historique de la chaine
  de distribution", "demander factures injecteurs apres 100k km")
- risky_period : si seulement certaines annees / Mk sont concernees ("Mk1 2010-2013")
- consensus : 1 phrase de synthese du verdict de la source

REPONSE EN FRANCAIS UNIQUEMENT, JSON STRICT conforme au schema.

Extraits :
"""
${excerpt.slice(0, 8000)}
"""`;
}

// Classe une source par fiabilite intrinseque pour ponderer le verdict.
// pro_specialise : Fiches-Auto (pannes mecaniques documentees)
// pro_generaliste : presse auto pro (Caradisiac articles, Auto Plus, Largus)
// forum_avis : forums, avis utilisateurs (Caradisiac forum, ParuVendu forum...)
// other : reste
export function classifyReliabilitySource(url, sourceProfile) {
  const u = (url || "").toLowerCase();
  if (u.includes("fiches-auto.fr")) return "pro_specialise";
  if (u.includes("forum") || u.includes("/communaute/") || u.includes("/avis/")) return "forum_avis";
  if (sourceProfile?.type === "magazine") return "pro_generaliste";
  if (u.match(/\b(caradisiac|autoplus|largus|automobile-magazine|auto-moto|autojournal|tuv-rapport|moniteurautomobile)\.[a-z]+/)) {
    return "pro_generaliste";
  }
  return "other";
}

// Poids des sources pour la fusion (pro speclialise > pro general > forum)
const SOURCE_WEIGHT = {
  pro_specialise: 3,
  pro_generaliste: 2,
  other: 1,
  forum_avis: 0.5,
};

function describeIdentity(identity) {
  const parts = [];
  if (identity?.marque) parts.push(`Marque: ${identity.marque}`);
  if (identity?.modele) parts.push(`Modele: ${identity.modele}`);
  if (identity?.finition) parts.push(`Finition: ${identity.finition}`);
  if (identity?.motorisation) parts.push(`Motorisation: ${identity.motorisation}`);
  if (identity?.energie) parts.push(`Energie: ${identity.energie}`);
  if (identity?.boite) parts.push(`Boite: ${identity.boite}`);
  if (identity?.annee) parts.push(`Annee: ${identity.annee}`);
  return parts.length ? parts.join("\n") : "(voiture non identifiee)";
}

// Cible les zones de texte pertinentes pour la fiabilite (mots-cles pannes,
// fiabilite, problemes...). Sinon on prendrait la totalite de la page et on
// noierait Nano dans du contenu marketing/specs.
function extractReliabilityContext(text, maxLen = 8000) {
  if (!text) return "";
  const keywords = /\b(fiabilit[ée]|panne|probl[èe]me|d[ée]faut|faiblesse|cha[îi]ne de distribution|courroie|FAP|EGR|injecteur|turbo|embrayage|volant moteur|bi-?masse|pompe|joint de culasse|huile|consommation|usure|km|kilom[èe]trage|rappel|recall|verifier|controle|symptome|voyant|fum[ée]e|casse|robuste|reference|fiable|surveiller)/i;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = [];
  let len = 0;
  for (const s of sentences) {
    if (keywords.test(s)) {
      kept.push(s);
      len += s.length;
      if (len > maxLen) break;
    }
  }
  if (kept.length) return kept.join(" ");
  return text.slice(0, maxLen);
}

// Construit les requetes web specifiques a la fiabilite.
export function buildReliabilityQueries(identity) {
  const baseTier = compactAutoIdentity(identity);
  if (!baseTier) return [];
  const motor = identity.motorisation ? ` ${identity.motorisation}` : "";
  return [
    {
      source: "Fiabilité - Fiches-Auto",
      query: `${baseTier}${motor} fiabilité pannes site:fiches-auto.fr`,
    },
    {
      source: "Pannes connues",
      query: `${baseTier}${motor} pannes connues problèmes fréquents`,
    },
    {
      source: "Distribution / EGR / FAP",
      query: `${baseTier}${motor} chaine distribution courroie egr fap problème`,
    },
    {
      source: "Avis propriétaires",
      query: `${baseTier}${motor} avis fiabilité retour propriétaires forum`,
    },
  ];
}

// Tente de construire l'URL canonique Fiches-Auto pour ce modele.
// Pattern : https://www.fiches-auto.fr/fiabilite-<marque>/fiabilite-<id>-pannes-<marque>-<modele>.php
// Le <id> est imprevisible, mais on peut au moins generer le slug fiabilite-<marque>
// pour que le LLM ranking ait plus de chances de selectionner cette page.
// On retourne plutot une query Bing/Google qui force le path.
export function buildFichesAutoQuery(identity) {
  if (!identity?.marque || !identity?.modele) return null;
  const marque = String(identity.marque).toLowerCase().replace(/\s+/g, "-");
  const modele = String(identity.modele).toLowerCase().replace(/\s+/g, "-");
  return {
    source: "Fiches-Auto direct",
    query: `pannes ${identity.marque} ${identity.modele} site:fiches-auto.fr/fiabilite-${marque}`,
    expectedUrlHint: `fiches-auto.fr/fiabilite-${marque}/fiabilite-*-pannes-${marque}-${modele}.php`,
  };
}

// Compacte l'identite pour les queries fiabilite (marque + modele + finition + annee)
function compactAutoIdentity(identity) {
  if (!identity) return "";
  return [identity.marque, identity.modele, identity.finition, identity.annee]
    .filter(Boolean)
    .join(" ");
}

// Fusion de plusieurs reports fiabilite avec ponderation par fiabilite source.
// reports = [{ report, sourceTier, sourceName }]
// - Score : moyenne ponderee (pro_specialise=3, pro_generaliste=2, other=1, forum=0.5)
// - Pannes : dedup par 'part'. Une panne MENTIONNEE PAR UN PRO compte plus qu'un
//   forum isole. Une panne mentionnee par >=2 sources est reputee fiable.
//   Une panne mentionnee uniquement par un forum est gardee mais marquee 'rare'.
export function mergeReliabilityReports(reports) {
  const valid = reports.filter((r) => r?.report);
  if (!valid.length) return null;

  // Score pondere
  const weighted = [];
  for (const { report, sourceTier } of valid) {
    if (typeof report.reliability_score === "number") {
      const w = SOURCE_WEIGHT[sourceTier] ?? 1;
      weighted.push({ score: report.reliability_score, w });
    }
  }
  const totalW = weighted.reduce((a, b) => a + b.w, 0);
  const reliability_score = totalW > 0
    ? Math.round(weighted.reduce((a, b) => a + b.score * b.w, 0) / totalW)
    : null;

  // Pannes : dedup par part. Pour chaque panne on track les sources mentionnant.
  const sevOrder = { mineur: 1, moyen: 2, grave: 3, critique: 4 };
  const freqOrder = { rare: 1, occasionnel: 2, frequent: 3, tres_frequent: 4 };
  const issuesByPart = new Map();
  for (const { report, sourceTier, sourceName } of valid) {
    for (const iss of report.known_issues || []) {
      if (!iss?.part) continue;
      const key = iss.part.toLowerCase().trim();
      const existing = issuesByPart.get(key);
      if (!existing) {
        issuesByPart.set(key, {
          ...iss,
          _sources: [{ tier: sourceTier, name: sourceName }],
          _proCount: sourceTier === "pro_specialise" || sourceTier === "pro_generaliste" ? 1 : 0,
        });
        continue;
      }
      existing._sources.push({ tier: sourceTier, name: sourceName });
      if (sourceTier === "pro_specialise" || sourceTier === "pro_generaliste") existing._proCount++;
      // On garde la version la plus alarmante venant d'un PRO si possible
      const isPro = sourceTier === "pro_specialise" || sourceTier === "pro_generaliste";
      if (isPro || existing._proCount === 0) {
        if (sevOrder[iss.severity] > sevOrder[existing.severity]) existing.severity = iss.severity;
        if (freqOrder[iss.frequency] > freqOrder[existing.frequency]) existing.frequency = iss.frequency;
        if (iss.description && (!existing.description || iss.description.length > existing.description.length)) {
          existing.description = iss.description;
        }
        if (iss.symptoms && !existing.symptoms) existing.symptoms = iss.symptoms;
        if (iss.fix_cost_eur && (!existing.fix_cost_eur || iss.fix_cost_eur > existing.fix_cost_eur)) {
          existing.fix_cost_eur = iss.fix_cost_eur;
        }
      }
    }
  }

  // Filtrage : on rejette les pannes mentionnees UNIQUEMENT par des forums
  // (pas de signal pro pour les confirmer). On les garde mais on flag rare.
  const known_issues = [...issuesByPart.values()]
    .filter((iss) => {
      // Si seulement des forums et 1 seule source : on droppe
      const allForum = iss._sources.every((s) => s.tier === "forum_avis");
      return !(allForum && iss._sources.length === 1);
    })
    .map((iss) => {
      const allForum = iss._sources.every((s) => s.tier === "forum_avis");
      if (allForum && !iss.frequency) iss.frequency = "rare"; // pas de signal pro = on minimise
      // On garde un flag interne mais on enleve _sources / _proCount du payload final
      const { _sources, _proCount, ...clean } = iss;
      return clean;
    })
    .slice(0, 8);

  const dedup = (arr) => [...new Set(arr.filter(Boolean).map((s) => s.trim()))];
  const strengths = dedup(valid.flatMap(({ report }) => report.strengths || [])).slice(0, 5);
  const must_check = dedup(valid.flatMap(({ report }) => report.must_check || [])).slice(0, 6);

  const risky_period = valid.map(({ report }) => report.risky_period).filter(Boolean).sort((a, b) => b.length - a.length)[0] || null;
  const consensus = valid.map(({ report }) => report.consensus).filter(Boolean).sort((a, b) => b.length - a.length)[0] || null;

  return { reliability_score, known_issues, strengths, must_check, risky_period, consensus };
}

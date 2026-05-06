// Construction des requêtes de recherche + ranking LLM des résultats — vélo.
// Port de bike_agent/ranking.py.

import { compactIdentity, getManufacturerDomain, isJuniorBike, searchQuerySuffix, bikeDescription } from "./identity.js";
import { KNOWN_RETAILERS, KNOWN_REFURBISHERS, PRICE_SOURCE_PROFILES } from "./catalog.js";

// Listes de domaines pour les requetes site:. On cible les principaux par catégorie.
const RETAILER_DOMAINS = KNOWN_RETAILERS.slice(0, 6).map((r) => r.domain);
// Pour les refurbishers, .domain est absent (regex). On extrait le nom et on
// suppose .com (matchera quand meme via regex .com|.fr|.de|...).
const REFURBISHER_DOMAINS = KNOWN_REFURBISHERS
  .map((r) => {
    if (r.domain) return r.domain;
    const m = String(r.match).match(/[a-z-]+\d*(?=\\?\.)/i);
    return m ? `${m[0]}.com` : null;
  })
  .filter(Boolean)
  .slice(0, 5);
// Magazines / comparateurs (99spokes, vitalmtb, velovert, etc.) - fallback MSRP.
const MAGAZINE_DOMAINS = PRICE_SOURCE_PROFILES.slice(0, 5).map((p) => p.domain);

export function buildSearchQueries(identity) {
  const baseTier = compactIdentity(identity, true);
  if (!baseTier) return { primary: [], fallback: [] };
  const baseNoTier = compactIdentity(identity, false);
  const hasTier = !!identity?.version && baseTier !== baseNoTier;
  const suffix = searchQuerySuffix(identity);
  const manufDomain = getManufacturerDomain(identity);

  // 4 niveaux : constructeur (MSRP) > retailers neuf > refurbishers occasion > magazines (MSRP fallback)
  function queriesFor(base, label = "") {
    const arr = [];
    // 1. Constructeur (priorite haute) : site: explicite si on connait le domaine
    if (manufDomain) {
      arr.push({ source: `Constructeur${label}`, domain: manufDomain, query: `${base}${suffix} site:${manufDomain}` });
    }
    // 2. Revendeurs de neuf
    const retailerSiteOR = RETAILER_DOMAINS.map((d) => `site:${d}`).join(" OR ");
    arr.push({ source: `Revendeurs neuf${label}`, domain: null, query: `${base}${suffix} (${retailerSiteOR})` });
    // 3. Refurbishers / occasion
    const refurbSiteOR = REFURBISHER_DOMAINS.map((d) => `site:${d}`).join(" OR ");
    if (refurbSiteOR) {
      arr.push({ source: `Reconditionneurs${label}`, domain: null, query: `${base}${suffix} (${refurbSiteOR})` });
    }
    // 4. Magazines / comparateurs (99spokes, vitalmtb, velovert) : fallback MSRP de reference
    const magazineSiteOR = MAGAZINE_DOMAINS.map((d) => `site:${d}`).join(" OR ");
    if (magazineSiteOR) {
      arr.push({ source: `Magazines${label}`, domain: null, query: `${base}${suffix} (${magazineSiteOR})` });
    }
    return arr;
  }

  return {
    primary: queriesFor(baseTier),
    fallback: hasTier ? queriesFor(baseNoTier, " (no tier)") : [],
  };
}

export const RANK_SCHEMA = {
  type: "object",
  properties: {
    selected: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["i", "reason"],
      },
    },
  },
  required: ["selected"],
};

export function buildRankPrompt(identity, candidates, topK = 6) {
  const desc = bikeDescription(identity);
  const juniorWarning = isJuniorBike(identity)
    ? `ATTENTION: velo JUNIOR/ENFANT. Rejette toute page qui parle de la version adulte du meme modele (26"/27.5"/29"). Garde uniquement les pages qui mentionnent explicitement la bonne taille de roues.\n`
    : "";
  const payload = candidates.map((c, i) => ({
    i,
    title: (c.title || "").slice(0, 200),
    url: c.url,
    snippet: (c.snippet || "").slice(0, 300),
    source: c.source_name,
  }));
  return `Velo cible:
${desc}

${juniorWarning}Voici une liste de resultats web (titre, url, extrait, source). Selectionne UNIQUEMENT ceux qui correspondent EXACTEMENT a ce velo (meme marque, meme modele, ET meme taille de roues — un velo 24" n'est PAS le meme produit qu'un 27.5 ou 29). Ils doivent contenir le PRIX NEUF, la FICHE TECHNIQUE ou la GEOMETRIE. Ignore: autres tailles de roues, autres modeles, vetements/accessoires, forums sans info technique. Limite a ${topK} resultats max, par ordre de pertinence decroissante.

Pour chaque resultat retenu, fournis i (l'index entier) et une raison courte. Reponds en JSON strict.

Resultats :
${JSON.stringify(payload, null, 2)}`;
}

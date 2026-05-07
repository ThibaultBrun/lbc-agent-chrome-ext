// Construction des requêtes de recherche + ranking LLM des résultats — vélo.
// Port de bike_agent/ranking.py.

import { compactIdentity, getManufacturerDomain, isJuniorBike, searchQuerySuffix, bikeDescription } from "./identity.js";

// Note : on n'utilise PAS d'operateur '(site:A OR site:B OR ...)' car DDG/Bing
// le supportent mal (souvent 0 hits). On utilise des queries en langage naturel
// et on filtre les resultats sur les listes officielles (KNOWN_RETAILERS / etc.)
// dans le pipeline (cf ACCEPTED_TYPES dans index.js).

export function buildSearchQueries(identity) {
  const baseTier = compactIdentity(identity, true);
  if (!baseTier) return { primary: [], fallback: [] };
  const baseNoTier = compactIdentity(identity, false);
  const hasTier = !!identity?.version && baseTier !== baseNoTier;
  const suffix = searchQuerySuffix(identity);
  const manufDomain = getManufacturerDomain(identity);

  // 4 angles d'attaque : constructeur > revendeurs neuf > occasion > catalogue.
  // Chaque query est en langage naturel (mots-cles + noms de revendeurs cibles).
  function queriesFor(base, label = "") {
    const arr = [];
    // 1. Constructeur (priorite haute) : site: explicite si on connait le domaine
    if (manufDomain) {
      arr.push({ source: `Constructeur${label}`, domain: manufDomain, query: `${base}${suffix} site:${manufDomain}` });
    }
    // 2. Revendeurs de neuf : query naturelle avec quelques noms cibles
    arr.push({
      source: `Revendeurs neuf${label}`,
      domain: null,
      query: `${base}${suffix} prix neuf alltricks bike-discount probikeshop bike24`,
    });
    // 3. Occasion / reconditionne : query naturelle ciblant les principaux
    arr.push({
      source: `Reconditionneurs${label}`,
      domain: null,
      query: `${base}${suffix} occasion reconditionne upway buycycle myveloshop`,
    });
    // 4. Catalogue / fiche technique : pour les magazines et les fiches de reference
    arr.push({
      source: `Catalogue${label}`,
      domain: null,
      query: `${base}${suffix} prix fiche technique geometrie`,
    });
    // 5. Test / review : pour les magazines (Velo Vert, Pinkbike...)
    arr.push({
      source: `Tests${label}`,
      domain: null,
      query: `${base}${suffix} test review essai velo`,
    });
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

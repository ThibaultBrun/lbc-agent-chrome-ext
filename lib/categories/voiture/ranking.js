// Construction des requetes de recherche + ranking LLM des resultats — voiture.

import { compactIdentity, getManufacturerDomain, autoDescription } from "./identity.js";

export function buildSearchQueries(identity) {
  const baseFull = compactIdentity(identity, true);
  if (!baseFull) return { primary: [], fallback: [] };
  const baseShort = compactIdentity(identity, false);
  const hasFinition = !!identity?.finition && baseFull !== baseShort;
  const motorSuffix = identity?.motorisation ? ` ${identity.motorisation}` : "";
  const manufDomain = getManufacturerDomain(identity);

  // Queries en langage naturel + nom de revendeurs cibles (DDG/Bing supportent
  // mal les '(site:A OR site:B OR ...)').
  function queriesFor(base, label = "") {
    const arr = [];
    if (manufDomain) {
      arr.push({ source: `Constructeur${label}`, domain: manufDomain, query: `${base}${motorSuffix} site:${manufDomain}` });
    }
    arr.push({
      source: `Cote occasion${label}`,
      query: `${base}${motorSuffix} cote argus la centrale prix occasion`,
    });
    arr.push({
      source: `Mandataires neuf${label}`,
      query: `${base}${motorSuffix} prix neuf aramis promo neuve auto ies`,
    });
    arr.push({
      source: `Fiche technique${label}`,
      query: `${base}${motorSuffix} fiche technique caradisiac auto plus`,
    });
    arr.push({
      source: `Tests / essais${label}`,
      query: `${base}${motorSuffix} test essai caradisiac auto-moto`,
    });
    return arr;
  }

  return {
    primary: queriesFor(baseFull),
    fallback: hasFinition ? queriesFor(baseShort, " (no finition)") : [],
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
  const desc = autoDescription(identity);
  const payload = candidates.map((c, i) => ({
    i,
    title: (c.title || "").slice(0, 200),
    url: c.url,
    snippet: (c.snippet || "").slice(0, 300),
    source: c.source_name,
  }));
  return `Voiture cible :
${desc}

Voici une liste de resultats web (titre, url, extrait, source). Selectionne UNIQUEMENT
ceux qui correspondent EXACTEMENT a cette voiture (meme marque, meme modele, meme
generation/finition si possible, meme motorisation si mentionnee).

Ils doivent contenir : prix neuf, cote occasion, fiche technique, ou test du modele
exact. Ignore : autres modeles meme marque, autres motorisations clairement
differentes, listes generiques de marque, forums sans info technique, annonces
particulieres (les comparables sont fetch ailleurs).

Limite a ${topK} resultats max, par ordre de pertinence decroissante. Pour chaque
resultat retenu, fournis i (l'index entier) et une raison courte. Reponds en JSON strict.

Resultats :
${JSON.stringify(payload, null, 2)}`;
}

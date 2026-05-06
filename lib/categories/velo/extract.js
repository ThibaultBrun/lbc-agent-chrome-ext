// Extraction d'annonce vélo : ajoute aux champs neutres les attributs LBC
// pertinents pour vélo (taille_roues, taille_cadre, électrique, état).
// ⚠ Fonctionne en CONTENT SCRIPT (accès à `document`).

import { extractAdBase } from "../../core/extract-base.js";
import { detect } from "./detect.js";

export function extractAd() {
  const base = extractAdBase();
  const isVelo = detect(base);
  return {
    ...base,
    is_velo: isVelo,
    category_hint: isVelo ? "velo" : null,
  };
}

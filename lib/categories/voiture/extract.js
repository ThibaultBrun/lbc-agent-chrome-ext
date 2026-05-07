// Extraction d'annonce voiture : ajoute aux champs neutres une heuristique
// is_voiture pour le content script.
// ⚠ Tourne en CONTENT SCRIPT (acces a `document`).

import { extractAdBase } from "../../core/extract-base.js";
import { detect } from "./detect.js";

export function extractAd() {
  const base = extractAdBase();
  const isVoiture = detect(base);
  return {
    ...base,
    is_voiture: isVoiture,
    category_hint: isVoiture ? "voiture" : null,
  };
}

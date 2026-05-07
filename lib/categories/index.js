// Registry des catégories. Pour ajouter une catégorie :
//   1. créer lib/categories/<id>/index.js qui exporte default { id, label, detect, enrichAd, uiRendererPath }
//   2. l'importer ici, l'ajouter au tableau (ordre = priorité)
//   3. la catégorie `default` doit toujours être en dernier (catch-all)

import velo from "./velo/index.js";
import voiture from "./voiture/index.js";
import fallback from "./default/index.js";

export const CATEGORIES = [velo, voiture, fallback];

export function resolveCategory(ad) {
  for (const c of CATEGORIES) {
    try { if (c.detect(ad)) return c; } catch { /* skip */ }
  }
  return fallback;
}

// Détection à partir de l'URL uniquement (utile au content script avant
// extraction complète de l'annonce, pour décider si on injecte l'overlay).
export function categoryFromUrl(url) {
  for (const c of CATEGORIES) {
    try { if (c.detect({ url })) return c; } catch { /* skip */ }
  }
  return fallback;
}

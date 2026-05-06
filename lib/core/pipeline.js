// Pipeline d'enrichissement générique.
// Charge le module de catégorie et délègue. La catégorie expose une fonction
// `enrichAd({ ad, llm, settings, emit })` qui suit le flow standard :
//   identity → web (search + ranking + price extraction) → comparables → synth.
//
// Le pipeline générique ne sait rien des catégories — il appelle juste
// `category.enrichAd(...)`. Toute la logique métier (prompts, schémas, règles)
// vit dans le dossier de catégorie.

import { resolveCategory } from "../categories/index.js";

export async function enrichAd({ ad, llm, settings, emit }) {
  const log = (msg) => emit?.({ type: "log", message: msg });
  const phase = (p, extra = {}) => emit?.({ type: "phase", phase: p, ...extra });

  const category = resolveCategory(ad);
  log(`[pipeline] catégorie détectée : ${category.id}`);
  emit?.({ type: "category", id: category.id, label: category.label });

  return category.enrichAd({ ad, llm, settings, emit, log, phase });
}

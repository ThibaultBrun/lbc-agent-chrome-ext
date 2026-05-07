// Detection : cette annonce est-elle une voiture ?

const AUTO_KEYWORDS = /\b(voiture|auto|berline|citadine|suv|crossover|coupe|cabriolet|monospace|break|utilitaire|4x4)\b/i;

export function detect(adOrCtx) {
  const url = adOrCtx?.url || (typeof location !== "undefined" ? location.href : "");
  if (/leboncoin\.fr\/ad\/voitures\//.test(url)) return true;
  if (/leboncoin\.fr\/ad\/(?:voitures_a_collectionner|utilitaires)\//.test(url)) return true;

  const cat = String(adOrCtx?.category_id || adOrCtx?.category_name || "").toLowerCase();
  // LBC : category 2 = voitures, 5 = utilitaires
  if (cat === "2" || cat === "5") return true;
  if (cat.includes("voiture") || cat.includes("utilitaire")) return true;

  const title = (adOrCtx?.subject || "").toLowerCase();
  if (AUTO_KEYWORDS.test(title)) return true;

  return false;
}

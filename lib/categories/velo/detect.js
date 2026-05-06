// Détection : cette annonce est-elle une annonce vélo ?

const VELO_KEYWORDS = /\b(velo|vélo|vtt|vtc|vae|vttae|gravel|bmx|cyclo|cyclisme|fat-?bike)\b/i;

export function detect(adOrCtx) {
  const url = adOrCtx?.url || (typeof location !== "undefined" ? location.href : "");
  if (/leboncoin\.fr\/ad\/velos\//.test(url)) return true;
  if (/leboncoin\.fr\/ad\/(?:velos_speciaux|equipements_velos)\//.test(url)) return true;

  const cat = String(adOrCtx?.category_id || adOrCtx?.category_name || "").toLowerCase();
  if (cat === "24" || cat.includes("velo") || cat.includes("vélo")) return true;

  const title = (adOrCtx?.subject || "").toLowerCase();
  if (VELO_KEYWORDS.test(title)) return true;

  return false;
}

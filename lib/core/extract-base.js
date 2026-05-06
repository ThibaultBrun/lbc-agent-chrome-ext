// Extraction d'annonce Leboncoin générique (titre/body/prix/lieu/attributs).
// Les détecteurs et extracteurs spécifiques (taille_roues vélo, km auto, m² immo)
// vivent dans lib/categories/<cat>/.
//
// ⚠ Ce module tourne en CONTENT SCRIPT (page LBC). Il a accès à `document`.

export function readJsonLd(doc = document) {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const items = [];
  for (const s of scripts) {
    try {
      const d = JSON.parse(s.textContent);
      if (Array.isArray(d)) items.push(...d);
      else items.push(d);
    } catch { /* ignore */ }
  }
  return items;
}

export function findProduct(items) {
  for (const it of items) {
    if (!it) continue;
    const t = it["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return it;
  }
  return null;
}

export function readNextData(doc = document) {
  const el = doc.querySelector('script#__NEXT_DATA__');
  if (!el) return null;
  try { return JSON.parse(el.textContent); } catch { return null; }
}

// Cherche récursivement dans __NEXT_DATA__ un objet ressemblant à une annonce LBC
// (heuristique : a un list_id et un subject ou body).
export function findAdInTree(obj, depth = 0) {
  if (!obj || depth > 10) return null;
  if (typeof obj === "object" && !Array.isArray(obj)) {
    if (obj.list_id && (obj.subject || obj.body)) return obj;
    for (const k of Object.keys(obj)) {
      const r = findAdInTree(obj[k], depth + 1);
      if (r) return r;
    }
  } else if (Array.isArray(obj)) {
    for (const it of obj) {
      const r = findAdInTree(it, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

export function pickAttributes(ad) {
  const out = {};
  for (const a of (ad.attributes || [])) {
    if (a.key && (a.value_label || a.value)) out[a.key] = a.value_label || a.value;
  }
  return out;
}

function textOrNull(sel, root = document) {
  const el = root.querySelector(sel);
  return el ? el.textContent.trim() : null;
}

// Extrait les champs neutres de l'annonce (jamais spécifiques à une catégorie).
export function extractAdBase() {
  const next = readNextData();
  const lbc = next ? findAdInTree(next) : null;
  const product = findProduct(readJsonLd());

  const titleFallback = textOrNull("h1") || document.title;
  const priceFallback =
    textOrNull('[data-qa-id="adview_price"]') ||
    textOrNull('[data-test-id="price"]') || null;
  const descriptionFallback =
    textOrNull('[data-qa-id="adview_description_container"]') ||
    textOrNull('[data-test-id="description"]') || null;
  const locationFallback =
    textOrNull('[data-qa-id="adview_location_informations"]') ||
    textOrNull('[data-test-id="location"]') || null;

  const subject = lbc?.subject || product?.name || titleFallback;
  const body = lbc?.body || product?.description || descriptionFallback;
  const price = lbc?.price?.[0] || lbc?.price ||
    (product?.offers?.price ? Number(product.offers.price) : null) ||
    (priceFallback ? parseInt(priceFallback.replace(/[^\d]/g, ""), 10) : null);
  const city = lbc?.location?.city || lbc?.city || locationFallback;
  const url = lbc?.url || location.href;
  const id = lbc?.list_id || (location.pathname.match(/\/ad\/[^/]+\/(\d+)/) || [])[1];
  const attributes = lbc ? pickAttributes(lbc) : {};
  const categoryId = lbc?.category_id;
  const categoryName = lbc?.category_name;

  return {
    id, url, subject, body, price, city, attributes,
    category_id: categoryId,
    category_name: categoryName,
    extracted_at: new Date().toISOString(),
  };
}

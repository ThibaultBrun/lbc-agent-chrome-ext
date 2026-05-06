// Content script: extrait les données de l'annonce Leboncoin
// Répond aux messages venant du popup/background avec un objet structuré.

function textOrNull(selector, root = document) {
  const el = root.querySelector(selector);
  return el ? el.textContent.trim() : null;
}

function readJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  const items = [];
  for (const s of scripts) {
    try {
      const data = JSON.parse(s.textContent);
      if (Array.isArray(data)) items.push(...data);
      else items.push(data);
    } catch (_) {
      // ignore
    }
  }
  return items;
}

function findProduct(items) {
  for (const it of items) {
    if (!it) continue;
    const t = it['@type'];
    if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return it;
  }
  return null;
}

function extractAd() {
  const items = readJsonLd();
  const product = findProduct(items);

  // Heuristiques de fallback si pas de JSON-LD
  const titleFallback = textOrNull('h1') || document.title;
  const priceFallback =
    textOrNull('[data-qa-id="adview_price"]') ||
    textOrNull('[data-test-id="price"]') ||
    null;
  const descriptionFallback =
    textOrNull('[data-qa-id="adview_description_container"]') ||
    textOrNull('[data-test-id="description"]') ||
    null;
  const locationFallback =
    textOrNull('[data-qa-id="adview_location_informations"]') ||
    textOrNull('[data-test-id="location"]') ||
    null;

  // Critères / caractéristiques (liste clé/valeur)
  const criteria = {};
  document
    .querySelectorAll('[data-qa-id="criteria_item"], [data-test-id^="criteria-item"]')
    .forEach((row) => {
      const label = row.querySelector('[data-qa-id="criteria_item_value"]')?.previousElementSibling?.textContent?.trim()
        || row.children[0]?.textContent?.trim();
      const value = row.querySelector('[data-qa-id="criteria_item_value"]')?.textContent?.trim()
        || row.children[1]?.textContent?.trim();
      if (label && value) criteria[label] = value;
    });

  const title = product?.name || titleFallback;
  const description = product?.description || descriptionFallback;
  const price =
    product?.offers?.price
      ? `${product.offers.price} ${product.offers.priceCurrency || 'EUR'}`
      : priceFallback;
  const category = product?.category || null;
  const images = (product?.image && (Array.isArray(product.image) ? product.image : [product.image])) || [];

  return {
    url: location.href,
    title,
    price,
    description,
    location: locationFallback,
    category,
    criteria,
    images: images.slice(0, 5),
    extractedAt: new Date().toISOString(),
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_AD') {
    try {
      sendResponse({ ok: true, data: extractAd() });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
    return true;
  }
});

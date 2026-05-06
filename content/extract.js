// Content script (1/2) : extraction de l'annonce Leboncoin.
// Expose window.__lbcBikeExtract() pour overlay.js.

(function () {
  function textOrNull(sel, root = document) {
    const el = root.querySelector(sel);
    return el ? el.textContent.trim() : null;
  }

  function readJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
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

  function findProduct(items) {
    for (const it of items) {
      if (!it) continue;
      const t = it["@type"];
      if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return it;
    }
    return null;
  }

  function readNextData() {
    const el = document.querySelector('script#__NEXT_DATA__');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch { return null; }
  }

  // Cherche récursivement dans __NEXT_DATA__ un objet ressemblant à une annonce LBC
  function findAdInTree(obj, depth = 0) {
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

  function pickAttributes(ad) {
    const out = {};
    for (const a of (ad.attributes || [])) {
      if (a.key && (a.value_label || a.value)) out[a.key] = a.value_label || a.value;
    }
    return out;
  }

  function isVeloAd(ad) {
    if (!ad) return false;
    const cat = String(ad.category_id || ad.category_name || "").toLowerCase();
    if (cat.includes("velo") || cat === "24") return true;
    // Heuristique URL
    return /\/ad\/velos\//.test(location.href);
  }

  function extractAd() {
    const next = readNextData();
    let lbc = null;
    if (next) lbc = findAdInTree(next);

    // Fallback JSON-LD
    const ldItems = readJsonLd();
    const product = findProduct(ldItems);

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
    const isVelo = isVeloAd(lbc) || /\/ad\/velos\//.test(url) || (subject || "").toLowerCase().match(/\b(velo|vtt|vtc|vae|gravel|bmx|cyclo)\b/);

    return {
      id, url, subject, body, price, city, attributes,
      is_velo: !!isVelo,
      extracted_at: new Date().toISOString(),
    };
  }

  window.__lbcBikeExtract = extractAd;

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === "EXTRACT_AD") {
      try { sendResponse({ ok: true, data: extractAd() }); }
      catch (e) { sendResponse({ ok: false, error: String(e?.message || e) }); }
      return true;
    }
  });
})();

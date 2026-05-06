// Content script (1/2) : extraction de l'annonce Leboncoin (générique + détection catégorie).
// Expose window.__lbcExtract() pour overlay.js.
// Pas d'import ESM ici : les content scripts ne supportent pas les modules sans hack.

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

  // ─── Détection catégorie (dupliqué ici car content script ne peut pas importer)
  // À garder synchrone avec lib/categories/<cat>/detect.js
  function detectCategory(ad) {
    const url = ad?.url || location.href;
    if (/leboncoin\.fr\/ad\/velos\//.test(url)) return "velo";
    if (/leboncoin\.fr\/ad\/(?:velos_speciaux|equipements_velos)\//.test(url)) return "velo";
    const cat = String(ad?.category_id || ad?.category_name || "").toLowerCase();
    if (cat === "24" || cat.includes("velo") || cat.includes("vélo")) return "velo";
    const title = (ad?.subject || "").toLowerCase();
    if (/\b(velo|vélo|vtt|vtc|vae|vttae|gravel|bmx|cyclo)\b/.test(title)) return "velo";
    return "default";
  }

  function extractAd() {
    // Pour les navs SPA Next.js : __NEXT_DATA__ ne se met pas a jour, donc on
    // verifie d'abord que l'ID dans __NEXT_DATA__ correspond a l'URL courante.
    // Sinon on ignore __NEXT_DATA__ et on tombe sur le DOM live (qui lui est a jour).
    const expectedId = (location.pathname.match(/\/ad\/[^/]+\/(\d+)/) || [])[1];
    const next = readNextData();
    let lbc = next ? findAdInTree(next) : null;
    if (lbc && expectedId && String(lbc.list_id) !== String(expectedId)) {
      // __NEXT_DATA__ correspond a une ancienne annonce → on l'ignore
      lbc = null;
    }
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

    const ad = {
      id, url, subject, body, price, city, attributes,
      category_id: categoryId,
      category_name: categoryName,
      extracted_at: new Date().toISOString(),
    };
    ad.category_hint = detectCategory(ad);
    ad.is_velo = ad.category_hint === "velo"; // legacy alias
    return ad;
  }

  window.__lbcExtract = extractAd;
  // Alias rétro-compat
  window.__lbcBikeExtract = extractAd;

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === "EXTRACT_AD") {
      try { sendResponse({ ok: true, data: extractAd() }); }
      catch (e) { sendResponse({ ok: false, error: String(e?.message || e) }); }
      return true;
    }
    // Relay fetch : le content script tourne sur leboncoin.fr donc ses cookies
    // (Datadome inclus) sont automatiquement transmis. Permet au background
    // de scraper LBC sans 403.
    if (msg?.type === "LBC_FETCH") {
      fetch(msg.url, { credentials: "include" })
        .then(async (r) => {
          if (!r.ok) { sendResponse({ ok: false, error: `HTTP ${r.status}` }); return; }
          const text = await r.text();
          sendResponse({ ok: true, text });
        })
        .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
      return true; // async
    }
  });
})();

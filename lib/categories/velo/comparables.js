// Comparables d'occasion vélo : Troc Vélo + Leboncoin (catégorie 24).
// Port de bike_agent/lbc.py + extension Troc Vélo.

import { httpGetWithCookies, normalizeSpace } from "../../core/utils.js";
import { detectElectric, wheelSizeInches } from "./identity.js";

// ─── Troc Vélo ────────────────────────────────────────────────────────────

function buildTrocVeloUrl(query) {
  const q = encodeURIComponent(query);
  return `https://www.troc-velo.com/recherche?q=${q}`;
}

function parseTrocVeloResults(html) {
  const out = [];
  const re = /<a[^>]+href="(\/petites-annonces\/[^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,2000})/gi;
  let m;
  const seen = new Set();
  while ((m = re.exec(html))) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const titleRaw = normalizeSpace(m[2].replace(/<[^>]+>/g, ""));
    const after = m[3] || "";
    const priceMatch = after.match(/(\d[\d\s.]{1,7})\s*€/);
    if (!priceMatch || !titleRaw || titleRaw.length < 5) continue;
    const price = parseInt(priceMatch[1].replace(/[^\d]/g, ""), 10);
    if (!price || price < 50 || price > 30000) continue;
    out.push({
      url: `https://www.troc-velo.com${path}`,
      subject: titleRaw.slice(0, 200),
      price_eur: price,
      source: "trocvelo",
    });
    if (out.length >= 30) break;
  }
  return out;
}

export async function fetchTrocVeloComparables(identity, log = () => {}) {
  if (!identity?.marque || !identity?.modele) {
    log("[trocvelo] identity incomplete, skip");
    return [];
  }
  const parts = [identity.marque, identity.modele];
  if (identity.annee) parts.push(String(identity.annee));
  const query = parts.join(" ");
  const url = buildTrocVeloUrl(query);
  log(`[trocvelo:search] "${query}" → ${url}`);

  let html;
  try {
    const r = await httpGetWithCookies(url, { timeout: 15000 });
    html = r.text;
    log(`[trocvelo:fetch] ${html.length} caractères reçus`);
  } catch (e) {
    log(`[trocvelo:error] ${e.message}`);
    return [];
  }

  const raw = parseTrocVeloResults(html);
  log(`[trocvelo:parse] ${raw.length} annonces brutes extraites du HTML`);
  return enrichComparables(raw, identity, log, "trocvelo");
}

// ─── Leboncoin (catégorie 24 = LOISIRS_VELOS) ───────────────────────────

function buildLbcUrl(query) {
  const q = encodeURIComponent(query);
  return `https://www.leboncoin.fr/recherche?category=24&text=${q}&sort=time`;
}

function parseLbcResults(html) {
  const out = [];
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const ads = walkForAds(data);
      for (const a of ads) {
        if (!a) continue;
        const price = typeof a.price === "number" ? a.price : (Array.isArray(a.price) ? a.price[0] : null);
        if (!price || price < 50 || price > 30000) continue;
        out.push({
          url: a.url || (a.list_id ? `https://www.leboncoin.fr/ad/velos/${a.list_id}` : null),
          subject: a.subject || a.title || "",
          body: a.body || "",
          price_eur: price,
          attributes: pickAttributes(a),
          source: "lbc",
          id: a.list_id,
        });
        if (out.length >= 30) break;
      }
      if (out.length) return out;
    } catch { /* ignore */ }
  }
  // Fallback regex simple
  const re = /href="\/ad\/velos\/(\d+)"[^>]*>([\s\S]*?)€[\s\S]{0,500}/gi;
  let m2;
  while ((m2 = re.exec(html))) {
    out.push({ id: m2[1], url: `https://www.leboncoin.fr/ad/velos/${m2[1]}`, subject: "", price_eur: null, source: "lbc" });
    if (out.length >= 20) break;
  }
  return out;
}

function walkForAds(obj, depth = 0, acc = []) {
  if (!obj || depth > 8) return acc;
  if (Array.isArray(obj)) {
    if (obj.length && obj[0] && typeof obj[0] === "object" && ("list_id" in obj[0] || "subject" in obj[0])) {
      for (const item of obj) acc.push(item);
    } else {
      for (const item of obj) walkForAds(item, depth + 1, acc);
    }
  } else if (typeof obj === "object") {
    for (const k of Object.keys(obj)) walkForAds(obj[k], depth + 1, acc);
  }
  return acc;
}

function pickAttributes(ad) {
  const attrs = {};
  for (const a of (ad.attributes || [])) {
    if (a.key && (a.value_label || a.value)) attrs[a.key] = a.value_label || a.value;
  }
  return attrs;
}

export async function fetchLbcComparables(identity, currentUrl, log = () => {}) {
  if (!identity?.marque || !identity?.modele) {
    log("[lbc] identity incomplete, skip");
    return [];
  }
  const parts = [identity.marque, identity.modele];
  if (identity.annee) parts.push(String(identity.annee));
  const query = parts.join(" ");
  const url = buildLbcUrl(query);
  log(`[lbc:search] "${query}" → ${url}`);

  let html;
  try {
    const r = await httpGetWithCookies(url, { timeout: 15000 });
    html = r.text;
    log(`[lbc:fetch] ${html.length} caractères reçus`);
  } catch (e) {
    log(`[lbc:error] ${e.message}`);
    return [];
  }

  const raw = parseLbcResults(html).filter((a) => a.url !== currentUrl);
  log(`[lbc:parse] ${raw.length} annonces brutes extraites du HTML`);
  return enrichComparables(raw, identity, log, "lbc");
}

// ─── Filtrage commun (tier-match, électrique, taille roues) ───────────────

function enrichComparables(raw, identity, log, sourceLabel) {
  const targetWheel = identity.taille_roues;
  const wheelInches = wheelSizeInches(identity);
  const enforceWheel = wheelInches !== null && wheelInches >= 14 && wheelInches <= 24;
  const versionLower = (identity.version || "").toLowerCase().trim();
  const targetElectric = identity.electric;

  const out = [];
  for (const a of raw) {
    if (!a.price_eur || a.price_eur < 50 || a.price_eur > 30000) continue;
    if (enforceWheel) {
      const adWheel = String(a.attributes?.bicycle_wheel_size || "");
      if (adWheel && !adWheel.includes(targetWheel)) continue;
    }
    const adText = `${a.subject || ""} ${a.body || ""}`;
    const adElectric = detectElectric(adText, a.attributes || {});
    if (targetElectric != null && adElectric != null && adElectric !== targetElectric) continue;

    const tierMatch = versionLower ? adText.toLowerCase().includes(versionLower) : null;
    out.push({ ...a, tier_match: tierMatch });
  }

  const matched = out.filter((c) => c.tier_match === true).length;
  log(`[${sourceLabel}:found] ${out.length} comparables retenus (${matched} tier-match)`);
  return out;
}

export async function fetchAllComparables(identity, currentUrl, settings, log = () => {}) {
  log(`[comparables:gate] trocvelo=${settings.enableTrocVeloComparables} lbc=${settings.enableLbcComparables}`);
  const tasks = [];
  if (settings.enableTrocVeloComparables !== false) {
    tasks.push(fetchTrocVeloComparables(identity, log).catch((e) => {
      log(`[trocvelo:exception] ${e.message}`); return [];
    }));
  } else log("[trocvelo] disabled in settings");
  if (settings.enableLbcComparables !== false) {
    tasks.push(fetchLbcComparables(identity, currentUrl, log).catch((e) => {
      log(`[lbc:exception] ${e.message}`); return [];
    }));
  } else log("[lbc] disabled in settings");
  const results = await Promise.all(tasks);
  return results.flat();
}

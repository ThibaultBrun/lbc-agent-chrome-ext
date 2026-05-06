// Comparables d'occasion vélo : Troc Vélo + Leboncoin (catégorie 24).
// Port de bike_agent/lbc.py + extension Troc Vélo.

import { httpGetWithCookies, normalizeSpace } from "../../core/utils.js";
import { detectElectric, wheelSizeInches } from "./identity.js";

// ─── Troc Vélo ────────────────────────────────────────────────────────────

function buildTrocVeloUrl(query) {
  const q = encodeURIComponent(query);
  return `https://www.troc-velo.com/recherche?q=${q}`;
}

// Patterns de fiches annonces Troc Vélo (le site a plusieurs versions)
const TROCVELO_AD_PATHS = [
  /\/petites-annonces\/[\w-]+/,
  /\/annonces?\/[\w-]+/,
  /\/vente-[\w-]+\.htm/,
  /\/[\w-]+-\d+\.htm$/,
];

function parseTrocVeloResults(html) {
  const out = [];
  const seen = new Set();

  // Stratégie 1 : tous les <a href="..."> qui ressemblent à une fiche annonce + prix proche
  const linkRe = /<a[^>]+href="(\/[^"#]*?)"[^>]*>([\s\S]{0,500}?)<\/a>([\s\S]{0,2500})/gi;
  let m;
  while ((m = linkRe.exec(html))) {
    let path = m[1].replace(/&amp;/g, "&");
    if (seen.has(path)) continue;
    if (!TROCVELO_AD_PATHS.some((re) => re.test(path))) continue;
    if (/^\/(recherche|categories?|c\/|search)/.test(path)) continue;
    seen.add(path);

    const titleRaw = normalizeSpace(m[2].replace(/<[^>]+>/g, ""));
    const after = m[3] || "";
    const priceMatch = after.match(/(\d[\d\s.]{1,7})\s*(?:€|EUR)/i);
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

  // Stratégie 2 : si Troc Vélo charge en JS, chercher du JSON intégré
  if (out.length === 0) {
    const jsonMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const ads = walkForTrocAds(data);
        for (const a of ads.slice(0, 30)) {
          const price = typeof a.price === "number" ? a.price : parseInt(a.price, 10);
          if (!price || price < 50 || price > 30000) continue;
          out.push({
            url: a.url?.startsWith("http") ? a.url : `https://www.troc-velo.com${a.url || ""}`,
            subject: a.title || a.subject || "",
            price_eur: price,
            source: "trocvelo",
          });
        }
      } catch { /* ignore */ }
    }
  }

  // Stratégie 3 (dernier recours) : extraction très permissive
  // - cherche un bloc qui contient un titre vélo + prix dans une <article>, <div class="card"> ou <li>
  if (out.length === 0) {
    const blockRe = /<(?:article|li|div)[^>]*(?:card|item|product|annonce|listing)[^>]*>([\s\S]{50,3000}?)<\/(?:article|li|div)>/gi;
    let bm;
    while ((bm = blockRe.exec(html))) {
      const block = bm[1];
      const link = block.match(/<a[^>]+href="(\/[^"#]+)"/);
      const priceM = block.match(/(\d[\d\s.]{1,7})\s*(?:€|EUR)/i);
      const titleM = block.match(/<(?:h[1-4]|span|p)[^>]*>([\s\S]{5,200}?)<\/(?:h[1-4]|span|p)>/i);
      if (!link || !priceM || !titleM) continue;
      const path = link[1].replace(/&amp;/g, "&");
      if (seen.has(path)) continue;
      seen.add(path);
      const price = parseInt(priceM[1].replace(/[^\d]/g, ""), 10);
      if (!price || price < 50 || price > 30000) continue;
      const title = normalizeSpace(titleM[1].replace(/<[^>]+>/g, ""));
      if (title.length < 5) continue;
      out.push({
        url: `https://www.troc-velo.com${path}`,
        subject: title.slice(0, 200),
        price_eur: price,
        source: "trocvelo",
      });
      if (out.length >= 30) break;
    }
  }

  return out;
}

function walkForTrocAds(obj, depth = 0, acc = []) {
  if (!obj || depth > 10) return acc;
  if (Array.isArray(obj)) {
    for (const it of obj) walkForTrocAds(it, depth + 1, acc);
  } else if (typeof obj === "object") {
    if ((obj.title || obj.subject) && (typeof obj.price === "number" || /^\d+$/.test(String(obj.price || "")))) {
      acc.push(obj);
    }
    for (const k of Object.keys(obj)) walkForTrocAds(obj[k], depth + 1, acc);
  }
  return acc;
}

async function fetchTrocVeloOnce(query, identity, log) {
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

export async function fetchTrocVeloComparables(identity, log = () => {}) {
  if (!identity?.marque || !identity?.modele) {
    log("[trocvelo] identity incomplete, skip");
    return [];
  }
  const queryFull = identity.annee
    ? `${identity.marque} ${identity.modele} ${identity.annee}`
    : `${identity.marque} ${identity.modele}`;
  let comparables = await fetchTrocVeloOnce(queryFull, identity, log);

  if (identity.annee && comparables.length < 5) {
    log(`[trocvelo:fallback] ${comparables.length} avec annee, retry sans annee`);
    const queryShort = `${identity.marque} ${identity.modele}`;
    const more = await fetchTrocVeloOnce(queryShort, identity, log);
    const seen = new Set(comparables.map((c) => c.url));
    for (const c of more) {
      if (!seen.has(c.url)) {
        seen.add(c.url);
        comparables.push(c);
      }
    }
    log(`[trocvelo:merge] ${comparables.length} comparables apres merge`);
  }
  return comparables;
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

// Demande au content script de l'onglet leboncoin.fr de fetch l'URL.
// Le service worker MV3 envoie ses propres requêtes sans contexte de page,
// donc Datadome retourne 403. Le content script tourne sur la même origine que LBC :
// les cookies + Datadome sont satisfaits.
async function fetchViaContentScript(url, timeout = 15000) {
  const tabs = await new Promise((resolve) =>
    chrome.tabs.query({ url: "https://www.leboncoin.fr/*" }, resolve)
  );
  if (!tabs || !tabs.length) {
    throw new Error("aucun onglet leboncoin.fr ouvert pour relayer le fetch");
  }
  // Ordre de priorité : onglet actif courant > premier dispo
  const tab = tabs.find((t) => t.active) || tabs[0];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout content-script fetch")), timeout);
    chrome.tabs.sendMessage(tab.id, { type: "LBC_FETCH", url }, (resp) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp) { reject(new Error("aucune réponse du content script")); return; }
      if (!resp.ok) { reject(new Error(resp.error || "fetch failed")); return; }
      resolve(resp.text);
    });
  });
}

async function fetchLbcOnce(query, currentUrl, identity, log) {
  const url = buildLbcUrl(query);
  log(`[lbc:search] "${query}" → ${url}`);

  let html;
  try {
    html = await fetchViaContentScript(url, 15000);
    log(`[lbc:fetch:via-content-script] ${html.length} caractères reçus`);
  } catch (e1) {
    log(`[lbc:cs-fetch:fail] ${e1.message} → fallback fetch direct`);
    try {
      const r = await httpGetWithCookies(url, { timeout: 15000 });
      html = r.text;
      log(`[lbc:fetch:direct] ${html.length} caractères reçus`);
    } catch (e2) {
      log(`[lbc:error] ${e2.message}`);
      return [];
    }
  }

  const raw = parseLbcResults(html).filter((a) => a.url !== currentUrl);
  log(`[lbc:parse] ${raw.length} annonces brutes extraites du HTML`);
  return enrichComparables(raw, identity, log, "lbc");
}

export async function fetchLbcComparables(identity, currentUrl, log = () => {}) {
  if (!identity?.marque || !identity?.modele) {
    log("[lbc] identity incomplete, skip");
    return [];
  }
  // Query 1 : marque + modele + annee (la plus precise)
  const queryFull = identity.annee
    ? `${identity.marque} ${identity.modele} ${identity.annee}`
    : `${identity.marque} ${identity.modele}`;
  let comparables = await fetchLbcOnce(queryFull, currentUrl, identity, log);

  // Si moins de 5 resultats avec annee, on retente sans annee pour avoir un meilleur signal marche
  if (identity.annee && comparables.length < 5) {
    log(`[lbc:fallback] ${comparables.length} comparables avec annee, retry sans annee`);
    const queryShort = `${identity.marque} ${identity.modele}`;
    const more = await fetchLbcOnce(queryShort, currentUrl, identity, log);
    // Merge en évitant les doublons par URL/id
    const seen = new Set(comparables.map((c) => c.url || c.id));
    for (const c of more) {
      const key = c.url || c.id;
      if (!seen.has(key)) {
        seen.add(key);
        comparables.push(c);
      }
    }
    log(`[lbc:merge] ${comparables.length} comparables apres merge`);
  }

  return comparables;
}

// ─── Filtrage commun (tier-match, électrique, taille roues) ───────────────

// Normalise un texte pour le matching : minuscules, espaces multiples, accents.
function normalizeForMatch(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les accents
    .replace(/[^a-z0-9\s]/g, " ")    // ponctuation → espace
    .replace(/\s+/g, " ")
    .trim();
}

function enrichComparables(raw, identity, log, sourceLabel) {
  const targetWheel = identity.taille_roues;
  const wheelInches = wheelSizeInches(identity);
  const enforceWheel = wheelInches !== null && wheelInches >= 14 && wheelInches <= 24;
  const versionLower = (identity.version || "").toLowerCase().trim();
  const targetElectric = identity.electric;

  // Match strict sur le TITRE uniquement : marque ET modele doivent y apparaitre.
  // Evite les faux positifs (annonces qui mentionnent "similaire a Orbea Wild" dans la
  // description mais vendent un autre modele).
  const brandLower = normalizeForMatch(identity.marque || "");
  const modelLower = normalizeForMatch(identity.modele || "");
  const requireTitleMatch = !!(brandLower && modelLower);

  const out = [];
  let droppedTitle = 0;
  for (const a of raw) {
    if (!a.price_eur || a.price_eur < 50 || a.price_eur > 30000) continue;
    if (enforceWheel) {
      const adWheel = String(a.attributes?.bicycle_wheel_size || "");
      if (adWheel && !adWheel.includes(targetWheel)) continue;
    }

    const titleNorm = normalizeForMatch(a.subject || "");
    if (requireTitleMatch) {
      // Le titre doit contenir marque ET modele (en mots entiers, gérés par les espaces autour)
      if (!titleNorm.includes(brandLower) || !titleNorm.includes(modelLower)) {
        droppedTitle++;
        continue;
      }
    }

    const adText = `${a.subject || ""} ${a.body || ""}`;
    const adElectric = detectElectric(adText, a.attributes || {});
    if (targetElectric != null && adElectric != null && adElectric !== targetElectric) continue;

    const tierMatch = versionLower ? adText.toLowerCase().includes(versionLower) : null;
    out.push({ ...a, tier_match: tierMatch });
  }

  const matched = out.filter((c) => c.tier_match === true).length;
  log(`[${sourceLabel}:found] ${out.length} comparables retenus (${matched} tier-match, ${droppedTitle} ecartes car titre ne match pas marque+modele)`);
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

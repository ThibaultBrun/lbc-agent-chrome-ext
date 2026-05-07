// Comparables d'occasion voiture : Leboncoin (cat. 2) + LesAnonces.com + Caradisiac.
// Le fetch LBC passe par le content script (datadome OK avec cookies utilisateur).
// Les autres sont fetch directs avec user-agent.

import { httpGetWithCookies, normalizeSpace } from "../../core/utils.js";

// ─── Leboncoin (categorie 2 = VOITURES) ────────────────────────────────

function buildLbcUrl(query) {
  const q = encodeURIComponent(query);
  return `https://www.leboncoin.fr/recherche?category=2&text=${q}&sort=time`;
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
        if (!price || price < 100 || price > 250000) continue;
        const attrs = pickAttributes(a);
        out.push({
          url: a.url || (a.list_id ? `https://www.leboncoin.fr/ad/voitures/${a.list_id}` : null),
          subject: a.subject || a.title || "",
          body: (a.body || "").slice(0, 500),
          price_eur: price,
          kilometrage_km: parseInt(String(attrs.mileage || "").replace(/[^\d]/g, ""), 10) || null,
          annee: parseInt(attrs.regdate || attrs.year || "", 10) || null,
          attributes: attrs,
          source: "lbc",
          id: a.list_id,
        });
        if (out.length >= 30) break;
      }
      if (out.length) return out;
    } catch { /* ignore */ }
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

async function fetchViaContentScript(url, timeout = 15000) {
  const tabs = await new Promise((resolve) =>
    chrome.tabs.query({ url: "https://www.leboncoin.fr/*" }, resolve)
  );
  if (!tabs || !tabs.length) {
    throw new Error("aucun onglet leboncoin.fr ouvert pour relayer le fetch");
  }
  const tab = tabs.find((t) => t.active) || tabs[0];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout content-script fetch")), timeout);
    chrome.tabs.sendMessage(tab.id, { type: "LBC_FETCH", url }, (resp) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
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
    } catch (e2) {
      log(`[lbc:error] ${e2.message}`);
      return [];
    }
  }
  const raw = parseLbcResults(html).filter((a) => a.url !== currentUrl);
  log(`[lbc:parse] ${raw.length} annonces brutes extraites du HTML`);
  return enrichAutoComparables(raw, identity, log, "lbc");
}

export async function fetchLbcComparables(identity, currentUrl, log = () => {}) {
  if (!identity?.marque || !identity?.modele) {
    log("[lbc] identity incomplete, skip");
    return [];
  }
  // Query precise : marque + modele + annee + (energie)
  const partsFull = [identity.marque, identity.modele];
  if (identity.annee) partsFull.push(String(identity.annee));
  if (identity.energie === "diesel") partsFull.push("diesel");
  else if (identity.energie === "essence") partsFull.push("essence");
  let comparables = await fetchLbcOnce(partsFull.join(" "), currentUrl, identity, log);

  // Fallback sans annee si peu de resultats
  if (identity.annee && comparables.length < 5) {
    log(`[lbc:fallback] ${comparables.length} avec annee, retry sans`);
    const partsShort = [identity.marque, identity.modele];
    if (identity.energie === "diesel") partsShort.push("diesel");
    const more = await fetchLbcOnce(partsShort.join(" "), currentUrl, identity, log);
    const seen = new Set(comparables.map((c) => c.url || c.id));
    for (const c of more) {
      const key = c.url || c.id;
      if (!seen.has(key)) {
        seen.add(key);
        comparables.push(c);
      }
    }
    log(`[lbc:merge] ${comparables.length} apres merge`);
  }
  return comparables;
}

// ─── LesAnonces.com ─────────────────────────────────────────────────────

function buildLesAnoncesUrl(query) {
  const q = encodeURIComponent(query);
  // URL de recherche LesAnonces (rubrique auto)
  return `https://www.lesanonces.com/search?category=auto&q=${q}`;
}

function parseLesAnoncesResults(html) {
  const out = [];
  const seen = new Set();
  // Pattern tolerant : <a href="/annonce/..."> ... </a> ... prix ...
  const re = /<a[^>]+href="(\/annonce[^"]+|\/auto\/[^"]+)"[^>]*>([\s\S]{0,500}?)<\/a>([\s\S]{0,2500})/gi;
  let m;
  while ((m = re.exec(html))) {
    const path = m[1].replace(/&amp;/g, "&");
    if (seen.has(path)) continue;
    seen.add(path);
    const titleRaw = normalizeSpace(m[2].replace(/<[^>]+>/g, ""));
    const after = m[3] || "";
    const priceMatch = after.match(/(\d[\d\s.]{2,8})\s*(?:€|EUR)/i);
    const kmMatch = after.match(/(\d{1,3}(?:[ .]\d{3})*)\s*km/i);
    if (!priceMatch || !titleRaw || titleRaw.length < 5) continue;
    const price = parseInt(priceMatch[1].replace(/[^\d]/g, ""), 10);
    if (!price || price < 100 || price > 250000) continue;
    const km = kmMatch ? parseInt(kmMatch[1].replace(/[ .]/g, ""), 10) : null;
    out.push({
      url: `https://www.lesanonces.com${path}`,
      subject: titleRaw.slice(0, 200),
      price_eur: price,
      kilometrage_km: km,
      source: "lesanonces",
    });
    if (out.length >= 25) break;
  }
  return out;
}

export async function fetchLesAnoncesComparables(identity, log = () => {}) {
  if (!identity?.marque || !identity?.modele) {
    log("[lesanonces] identity incomplete, skip");
    return [];
  }
  const query = [identity.marque, identity.modele, identity.annee].filter(Boolean).join(" ");
  const url = buildLesAnoncesUrl(query);
  log(`[lesanonces:search] "${query}" → ${url}`);
  let html;
  try {
    const r = await httpGetWithCookies(url, { timeout: 15000 });
    html = r.text;
    log(`[lesanonces:fetch] ${html.length} caractères reçus`);
  } catch (e) {
    log(`[lesanonces:error] ${e.message}`);
    return [];
  }
  const raw = parseLesAnoncesResults(html);
  log(`[lesanonces:parse] ${raw.length} annonces brutes`);
  return enrichAutoComparables(raw, identity, log, "lesanonces");
}

// ─── Caradisiac (annonces auto occasion) ───────────────────────────────

function buildCaradisiacUrl(query) {
  const q = encodeURIComponent(query);
  return `https://www.caradisiac.com/voiture-occasion/?q=${q}`;
}

function parseCaradisiacResults(html) {
  const out = [];
  const seen = new Set();
  // Pattern : carte annonce avec lien produit + prix
  const re = /<a[^>]+href="(\/[^"#]*?annonce-occasion[^"]*|\/voiture-occasion-[^"]+)"[^>]*>([\s\S]{0,500}?)<\/a>([\s\S]{0,2500})/gi;
  let m;
  while ((m = re.exec(html))) {
    const path = m[1].replace(/&amp;/g, "&");
    if (seen.has(path)) continue;
    seen.add(path);
    const titleRaw = normalizeSpace(m[2].replace(/<[^>]+>/g, ""));
    const after = m[3] || "";
    const priceMatch = after.match(/(\d[\d\s.]{2,8})\s*(?:€|EUR)/i);
    const kmMatch = after.match(/(\d{1,3}(?:[ .]\d{3})*)\s*km/i);
    if (!priceMatch || !titleRaw || titleRaw.length < 5) continue;
    const price = parseInt(priceMatch[1].replace(/[^\d]/g, ""), 10);
    if (!price || price < 100 || price > 250000) continue;
    const km = kmMatch ? parseInt(kmMatch[1].replace(/[ .]/g, ""), 10) : null;
    out.push({
      url: path.startsWith("http") ? path : `https://www.caradisiac.com${path}`,
      subject: titleRaw.slice(0, 200),
      price_eur: price,
      kilometrage_km: km,
      source: "caradisiac",
    });
    if (out.length >= 25) break;
  }
  return out;
}

export async function fetchCaradisiacComparables(identity, log = () => {}) {
  if (!identity?.marque || !identity?.modele) {
    log("[caradisiac] identity incomplete, skip");
    return [];
  }
  const query = [identity.marque, identity.modele, identity.annee].filter(Boolean).join(" ");
  const url = buildCaradisiacUrl(query);
  log(`[caradisiac:search] "${query}" → ${url}`);
  let html;
  try {
    const r = await httpGetWithCookies(url, { timeout: 15000 });
    html = r.text;
    log(`[caradisiac:fetch] ${html.length} caractères reçus`);
  } catch (e) {
    log(`[caradisiac:error] ${e.message}`);
    return [];
  }
  const raw = parseCaradisiacResults(html);
  log(`[caradisiac:parse] ${raw.length} annonces brutes`);
  return enrichAutoComparables(raw, identity, log, "caradisiac");
}

// ─── Filtrage commun : titre doit matcher marque + modele ─────────────

function normalizeForMatch(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function enrichAutoComparables(raw, identity, log, sourceLabel) {
  const brandLower = normalizeForMatch(identity.marque || "");
  const modelLower = normalizeForMatch(identity.modele || "");
  const requireTitleMatch = !!(brandLower && modelLower);
  const targetEnergy = identity.energie;

  const out = [];
  let droppedTitle = 0;
  let droppedEnergy = 0;

  for (const a of raw) {
    if (!a.price_eur || a.price_eur < 100 || a.price_eur > 250000) continue;

    const titleNorm = normalizeForMatch(a.subject || "");
    if (requireTitleMatch) {
      if (!titleNorm.includes(brandLower) || !titleNorm.includes(modelLower)) {
        droppedTitle++;
        continue;
      }
    }

    // Filtre energie si on en a une stricte (utile pour distinguer essence vs diesel)
    if (targetEnergy && (targetEnergy === "essence" || targetEnergy === "diesel" || targetEnergy === "electrique")) {
      const text = `${a.subject || ""} ${a.body || ""}`.toLowerCase();
      const adIsDiesel = /\bdiesel\b|\bhdi\b|\btdi\b|\bdci\b|\bbluehdi\b/.test(text);
      const adIsEssence = /\bessence\b|\btsi\b|\btfsi\b|\b\d\.\d\s+(?:vti|thp|vvt|sci)\b/.test(text);
      const adIsElec = /\belectrique\b|\b100%\s+elec/.test(text);
      const targets = {
        essence: adIsEssence && !adIsDiesel,
        diesel: adIsDiesel && !adIsEssence,
        electrique: adIsElec,
      };
      // Si on a une energie target ET qu'on detecte explicitement l'autre dans l'ad : skip
      if (targets[targetEnergy] === false && (adIsDiesel || adIsEssence || adIsElec)) {
        droppedEnergy++;
        continue;
      }
    }

    out.push(a);
  }

  log(`[${sourceLabel}:found] ${out.length} comparables retenus (${droppedTitle} ecartes titre, ${droppedEnergy} ecartes energie)`);
  return out;
}

// ─── API publique ──────────────────────────────────────────────────────

export async function fetchAllComparables(identity, currentUrl, settings, log = () => {}) {
  log(`[comparables:gate] lbc=${settings.enableLbcComparables} lesanonces=true caradisiac=true`);
  const tasks = [];
  if (settings.enableLbcComparables !== false) {
    tasks.push(fetchLbcComparables(identity, currentUrl, log).catch((e) => {
      log(`[lbc:exception] ${e.message}`); return [];
    }));
  } else log("[lbc] disabled in settings");
  // LesAnonces et Caradisiac : activees par defaut, controlables par la meme option
  // 'enableTrocVeloComparables' en V1 (on n'a pas ajoute d'option auto specifique pour ne pas
  // multiplier les checkboxes dans Options).
  if (settings.enableTrocVeloComparables !== false) {
    tasks.push(fetchLesAnoncesComparables(identity, log).catch((e) => {
      log(`[lesanonces:exception] ${e.message}`); return [];
    }));
    tasks.push(fetchCaradisiacComparables(identity, log).catch((e) => {
      log(`[caradisiac:exception] ${e.message}`); return [];
    }));
  }
  const results = await Promise.all(tasks);
  return results.flat();
}

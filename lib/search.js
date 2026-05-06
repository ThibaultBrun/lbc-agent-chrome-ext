// Web search : DuckDuckGo Lite → Bing → Jina Reader (sans clé) en fallback.
// Port de bike_agent/search.py + parsers HTML adaptés au DOM via DOMParser.

import { httpGet, normalizeSpace, domainOf } from "./utils.js";
import { EXCLUDED_RESULT_DOMAINS } from "./config.js";

function unwrapBingRedirect(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("bing.com") && u.pathname.includes("/ck/a")) {
      let target = u.searchParams.get("u") || "";
      if (target.startsWith("a1")) {
        target = target.slice(2);
        const padding = "=".repeat((4 - (target.length % 4)) % 4);
        const decoded = atob(target.replace(/-/g, "+").replace(/_/g, "/") + padding);
        return decoded;
      }
    }
  } catch { /* ignore */ }
  return url;
}

function cleanDdgUrl(url) {
  if (!url) return url;
  if (url.startsWith("//")) url = "https:" + url;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("duckduckgo.com") && u.pathname.startsWith("/l/")) {
      const target = u.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }
  } catch { /* ignore */ }
  return url;
}

function isInternalDomain(url, domain) {
  try { return new URL(url).hostname.endsWith(domain); } catch { return false; }
}

function isExcluded(url) {
  const d = domainOf(url);
  return EXCLUDED_RESULT_DOMAINS.some((bad) => d.endsWith(bad));
}

function uniqueResults(results, max) {
  const seen = new Set();
  const out = [];
  for (const r0 of results) {
    const url = unwrapBingRedirect(r0.url);
    if (!url || seen.has(url) || isExcluded(url)) continue;
    seen.add(url);
    out.push({ ...r0, url });
    if (out.length >= max) break;
  }
  return out;
}

// Le service worker n'a pas DOMParser ; on utilise une regex tolerante.
// Pour DDG Lite, les liens portent class "result-link" + extrait dans <td class="result-snippet">.
function parseDdgLite(html) {
  const out = [];
  const re = /<a[^>]+class="[^"]*result-link[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result-link|<\/table>|$)/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = cleanDdgUrl(m[1].replace(/&amp;/g, "&"));
    const title = normalizeSpace(m[2].replace(/<[^>]+>/g, ""));
    const block = m[3] || "";
    const sn = block.match(/<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const snippet = sn ? normalizeSpace(sn[1].replace(/<[^>]+>/g, "")) : "";
    if (href && title && !isInternalDomain(href, "duckduckgo.com")) {
      out.push({ title, url: href, snippet });
    }
  }
  return out;
}

function parseBing(html) {
  const out = [];
  const blockRe = /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<\/li>/gi;
  let m;
  while ((m = blockRe.exec(html))) {
    const block = m[0];
    const a = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (!a) continue;
    const url = a[1];
    const title = normalizeSpace(a[2].replace(/<[^>]+>/g, ""));
    const snippet = p ? normalizeSpace(p[1].replace(/<[^>]+>/g, "")) : "";
    if (url && title) out.push({ title, url, snippet });
  }
  return out;
}

export async function duckduckgoSearch(query, max = 10) {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const { text } = await httpGet(url, { timeout: 12000, headers: { Referer: "https://duckduckgo.com/" } });
  if (text.toLowerCase().includes("anomaly")) return [];
  return uniqueResults(parseDdgLite(text), max);
}

export async function bingSearch(query, max = 10) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const { text } = await httpGet(url, { timeout: 12000, headers: { Referer: "https://www.bing.com/" } });
  return uniqueResults(parseBing(text), max);
}

// Jina Reader sans clé — on demande à r.jina.ai de fetcher la page de résultats Bing.
// Plus lent mais contourne les 403 occasionnels.
export async function jinaProxySearch(query, max = 10) {
  const target = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const url = `https://r.jina.ai/${target}`;
  const { text } = await httpGet(url, { timeout: 18000, useCache: true, headers: { "X-Return-Format": "html" } });
  return uniqueResults(parseBing(text), max);
}

export async function webSearch(query, max = 10, log = () => {}) {
  log(`[search] ${query}`);
  try {
    const r = await duckduckgoSearch(query, max);
    if (r.length >= 3) return r;
    log(`[search] DDG retourne ${r.length}, fallback Bing`);
  } catch (e) { log(`[search] DDG fail: ${e.message}`); }
  try {
    const r = await bingSearch(query, max);
    if (r.length >= 1) return r;
  } catch (e) { log(`[search] Bing fail: ${e.message}`); }
  try {
    return await jinaProxySearch(query, max);
  } catch (e) { log(`[search] Jina fail: ${e.message}`); return []; }
}

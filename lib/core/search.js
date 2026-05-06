// Web search 100% générique : DuckDuckGo Lite → Bing → Jina Reader.
// Les domaines à exclure peuvent être étendus par catégorie via `excludedDomains`.

import { httpGet, normalizeSpace, domainOf } from "./utils.js";
import { EXCLUDED_RESULT_DOMAINS_BASE } from "./config.js";

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

function makeIsExcluded(extraExcluded = []) {
  const all = [...EXCLUDED_RESULT_DOMAINS_BASE, ...extraExcluded];
  return (url) => {
    const d = domainOf(url);
    return all.some((bad) => d.endsWith(bad));
  };
}

function uniqueResults(results, max, isExcluded) {
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

export async function duckduckgoSearch(query, max = 10, isExcluded) {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const { text } = await httpGet(url, { timeout: 12000, headers: { Referer: "https://duckduckgo.com/" } });
  if (text.toLowerCase().includes("anomaly")) return [];
  return uniqueResults(parseDdgLite(text), max, isExcluded);
}

export async function bingSearch(query, max = 10, isExcluded) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const { text } = await httpGet(url, { timeout: 12000, headers: { Referer: "https://www.bing.com/" } });
  return uniqueResults(parseBing(text), max, isExcluded);
}

export async function jinaProxySearch(query, max = 10, isExcluded) {
  const target = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const url = `https://r.jina.ai/${target}`;
  const { text } = await httpGet(url, { timeout: 18000, useCache: true, headers: { "X-Return-Format": "html" } });
  return uniqueResults(parseBing(text), max, isExcluded);
}

export async function webSearch(query, max = 10, { log = () => {}, excludedDomains = [] } = {}) {
  const isExcluded = makeIsExcluded(excludedDomains);
  try {
    const r = await duckduckgoSearch(query, max, isExcluded);
    if (r.length >= 3) { log(`  [DDG] ${r.length} hits`); return r; }
    log(`  [DDG] ${r.length} hits — fallback Bing`);
  } catch (e) { log(`  [DDG:fail] ${e.message}`); }
  try {
    const r = await bingSearch(query, max, isExcluded);
    if (r.length >= 1) { log(`  [Bing] ${r.length} hits`); return r; }
    log(`  [Bing] 0 hits — fallback Jina`);
  } catch (e) { log(`  [Bing:fail] ${e.message}`); }
  try {
    const r = await jinaProxySearch(query, max, isExcluded);
    log(`  [Jina] ${r.length} hits`);
    return r;
  } catch (e) { log(`  [Jina:fail] ${e.message}`); return []; }
}

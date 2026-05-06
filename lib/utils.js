// Helpers communs : normalize, median, sleep, throttle, cache.

import { CACHE_TTL_MS, DOMAIN_MIN_INTERVAL_MS, USER_AGENTS } from "./config.js";

export function normalizeSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

export function median(values) {
  const cleaned = values.filter((v) => typeof v === "number" && !Number.isNaN(v) && v >= 50).slice().sort((a, b) => a - b);
  if (!cleaned.length) return null;
  const n = cleaned.length;
  return n % 2 ? cleaned[(n - 1) / 2] : (cleaned[n / 2 - 1] + cleaned[n / 2]) / 2;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Throttle par domaine (clé en mémoire dans le service worker).
const lastRequestAt = new Map();
export async function throttle(url) {
  const host = domainOf(url);
  const interval = DOMAIN_MIN_INTERVAL_MS[host] ?? 300;
  const last = lastRequestAt.get(host) || 0;
  const wait = last + interval - Date.now();
  if (wait > 0) await sleep(wait + Math.random() * 200);
  lastRequestAt.set(host, Date.now());
}

// Cache disque via chrome.storage.local (TTL 7j) — clé = hash simple de l'URL.
function hashKey(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return "c_" + (h >>> 0).toString(36) + "_" + s.length;
}

export async function cacheGet(url) {
  if (!chrome?.storage?.local) return null;
  const key = hashKey(url);
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => {
      const entry = items[key];
      if (entry && Date.now() - entry.t < CACHE_TTL_MS) resolve(entry.v);
      else resolve(null);
    });
  });
}

export async function cacheSet(url, value) {
  if (!chrome?.storage?.local) return;
  const key = hashKey(url);
  const entry = { t: Date.now(), v: value };
  return new Promise((resolve) => chrome.storage.local.set({ [key]: entry }, resolve));
}

export async function cacheClear() {
  if (!chrome?.storage?.local) return;
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (items) => {
      const keys = Object.keys(items).filter((k) => k.startsWith("c_"));
      chrome.storage.local.remove(keys, resolve);
    });
  });
}

// fetch HTTP avec UA aléatoire, throttle, cache, fallback robuste.
export async function httpGet(url, { timeout = 12000, useCache = true, headers = {} } = {}) {
  if (useCache) {
    const cached = await cacheGet(url);
    if (cached !== null) return { text: cached, cached: true };
  }
  await throttle(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": pickUA(), Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", ...headers },
      signal: controller.signal,
      credentials: "omit",
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} on ${domainOf(url)}`);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    if (useCache) await cacheSet(url, text);
    return { text, cached: false };
  } finally {
    clearTimeout(timer);
  }
}

// Variante : fetch avec credentials du navigateur (utile pour leboncoin.fr / troc-velo.com)
export async function httpGetWithCookies(url, { timeout = 12000, useCache = false, headers = {} } = {}) {
  if (useCache) {
    const cached = await cacheGet(url);
    if (cached !== null) return { text: cached, cached: true };
  }
  await throttle(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", ...headers },
      signal: controller.signal,
      credentials: "include",
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} on ${domainOf(url)}`);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    if (useCache) await cacheSet(url, text);
    return { text, cached: false };
  } finally {
    clearTimeout(timer);
  }
}

// Logger avec prefix optionnel — visible dans la console du service worker.
export function logger(prefix = "[bike]") {
  return {
    log: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    err: (...args) => console.error(prefix, ...args),
  };
}

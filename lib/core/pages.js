// Fetch HTML/markdown + extraction regex prix générique.
// Le prompt LLM d'extraction de prix est spécifique à chaque catégorie : il vit
// dans lib/categories/<cat>/pages.js (ex: pour vélo, hint manufacturer/retailer).

import { httpGet } from "./utils.js";
import { PRICE_RE, PRICE_CONTEXT_RE } from "./config.js";

export function parsePriceAmount(raw) {
  let v = raw.replace(/\s*(€|eur|euros)\s*$/i, "").trim().replace(/\s/g, "");
  if (/[,.]\d{1,2}$/.test(v)) v = v.split(/[,.]/)[0];
  v = v.replace(/\./g, "");
  if (!/^\d+$/.test(v)) return null;
  return parseInt(v, 10);
}

export function extractPricesFromText(text) {
  const out = [];
  const seen = new Set();
  if (!text) return out;
  PRICE_RE.lastIndex = 0;
  let m;
  while ((m = PRICE_RE.exec(text))) {
    const raw = m[0].replace(/\s+/g, " ").trim();
    const amount = parsePriceAmount(raw);
    if (amount === null || amount < 50 || amount > 100000) continue;
    const key = `${amount}|${raw.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ amount_eur: amount, raw });
  }
  return out;
}

export function htmlToText(html) {
  return (html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Fetch page texte : Jina Reader (Markdown propre, contourne Cloudflare) puis fetch direct.
export async function fetchPageText(url, { timeout = 18000 } = {}) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    const { text } = await httpGet(jinaUrl, { timeout, useCache: true });
    return { ok: true, text: text.slice(0, 250_000), via: "jina" };
  } catch {
    try {
      const { text } = await httpGet(url, { timeout, useCache: true });
      return { ok: true, text: htmlToText(text).slice(0, 250_000), via: "direct" };
    } catch (e2) {
      return { ok: false, text: "", via: "none", error: e2.message };
    }
  }
}

export function extractPriceContext(text, window = 400, maxChunks = 8) {
  if (!text) return "";
  const chunks = [];
  let lastEnd = -1;
  const re = new RegExp(PRICE_CONTEXT_RE.source, "gi");
  let m;
  while ((m = re.exec(text)) && chunks.length < maxChunks) {
    const start = Math.max(0, m.index - window);
    const end = Math.min(text.length, m.index + m[0].length + Math.floor(window / 2));
    if (start <= lastEnd) continue;
    chunks.push(text.slice(start, end));
    lastEnd = end;
  }
  return chunks.length ? chunks.join("\n---\n") : text.slice(0, 4000);
}

// Schéma JSON générique pour l'extraction de prix sur une page
// (la catégorie crafte le PROMPT, le schéma reste partagé).
export const PRICE_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    prices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          amount_eur: { type: "integer" },
          kind: { type: "string", enum: ["msrp", "retail", "current", "used", "sale", "unknown"] },
          context: { type: "string" },
        },
        required: ["amount_eur", "kind"],
      },
    },
  },
  required: ["prices"],
};

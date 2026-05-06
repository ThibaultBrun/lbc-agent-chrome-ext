// Port de bike_agent/pages.py : fetch_page_text + extract_prices_with_llm.
// Stratégie : Jina Reader sans clé en premier (contourne Cloudflare), fallback fetch direct.

import { httpGet } from "./utils.js";
import { PRICE_RE, PRICE_CONTEXT_RE } from "./config.js";
import { bikeDescription, isJuniorBike } from "./identity.js";

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
    if (amount === null || amount < 50 || amount > 20000) continue;
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

export async function fetchPageText(url, { timeout = 18000 } = {}) {
  // Jina Reader d'abord (Markdown propre, contourne Cloudflare)
  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    const { text } = await httpGet(jinaUrl, { timeout, useCache: true });
    return { ok: true, text: text.slice(0, 250_000), via: "jina" };
  } catch (e) {
    // Fallback fetch direct
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

export function buildPriceExtractionPrompt(identity, pageText, sourceUrl, sourceProfile) {
  const desc = bikeDescription(identity);
  const sp = sourceProfile || {};
  const stype = sp.type || "other";
  const sname = sp.name || "?";
  let hint = "";
  if (stype === "manufacturer") {
    hint = `\nSOURCE TYPE: site CONSTRUCTEUR (${sname}). REGLE STRICTE: kind = 'msrp' (catalogue) ou 'sale' (promo). Jamais 'retail' sur un constructeur.\n`;
  } else if (stype === "retailer") {
    hint = `\nSOURCE TYPE: gros revendeur en ligne (${sname}). Le prix de vente actuel = 'retail'. Si un prix est barre = 'msrp'. Si promo explicite = 'sale'.\n`;
  } else if (stype === "magazine") {
    hint = `\nSOURCE TYPE: magazine/comparateur (${sname}). Le prix mentionne est generalement le MSRP de reference (kind='msrp').\n`;
  }
  const junior = isJuniorBike(identity)
    ? "ATTENTION: velo JUNIOR/ENFANT. Ignore les prix relatifs aux versions adultes (26\"/27.5\"/29\"). Garde uniquement les prix qui mentionnent explicitement la bonne taille de roues.\n"
    : "";
  const excerpt = extractPriceContext(pageText);
  return `Velo cible:
${desc}
Source: ${sourceUrl}${hint}
${junior}
Voici des extraits d'une page web autour de mentions de prix. Identifie UNIQUEMENT les prix qui correspondent au velo cible (meme marque, meme modele, meme taille de roues — pas les composants seuls, pas d'accessoires).

Pour chaque prix retenu :
- amount_eur : montant entier en euros
- kind : 'msrp' (catalogue constructeur RRP) | 'retail' (vente actuelle revendeur) | 'current' (prix courant constate) | 'used' (occasion) | 'sale' (promo explicite -X%)
- context : 1-15 mots de contexte (ex: "promo -20%", "prix neuf catalogue Alltricks")

Reponds en JSON strict {"prices": [...]}.

Extraits :
"""
${excerpt.slice(0, 6000)}
"""`;
}

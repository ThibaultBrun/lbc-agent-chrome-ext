// Identité vélo : marque, modèle, version, année, taille_roues, taille_cadre, electric.
// Port de bike_agent/identity.py.

import { normalizeSpace } from "../../core/utils.js";
import {
  ALLOWED_WHEEL_SIZES,
  ELECTRIC_KEYWORDS,
  MANUFACTURER_DOMAINS,
  NON_ELECTRIC_HINTS,
  VARIANT_TIERS,
  KNOWN_RETAILERS,
  KNOWN_REFURBISHERS,
  PRICE_SOURCE_PROFILES,
} from "./catalog.js";

export function detectElectric(text, attributes = {}) {
  const raw = String(attributes.bicycle_electric ?? attributes.electric ?? "").toLowerCase().trim();
  if (["true", "yes", "oui", "1"].includes(raw)) return true;
  if (["false", "no", "non", "0"].includes(raw)) return false;
  if (!text) return null;
  const lower = " " + text.toLowerCase() + " ";
  for (const h of NON_ELECTRIC_HINTS) if (lower.includes(h)) return false;
  for (const k of ELECTRIC_KEYWORDS) if (lower.includes(k)) return true;
  return null;
}

export function detectVariantTier(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const tier of VARIANT_TIERS) {
    const pat = new RegExp(`(?<![a-z])${tier.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "i");
    if (pat.test(lower)) return tier;
  }
  return null;
}

export function wheelSizeInches(identity) {
  const raw = String(identity?.taille_roues || "").toLowerCase();
  const m = raw.match(/(\d{2}(?:[.,]\d)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

export function isJuniorBike(identity) {
  const s = wheelSizeInches(identity);
  return s !== null && s >= 14 && s <= 24;
}

export function compactIdentity(identity, includeVersion = true) {
  const parts = [
    identity?.marque,
    includeVersion ? identity?.version : null,
    identity?.modele,
    identity?.annee ? String(identity.annee) : null,
  ].filter(Boolean);
  return parts.join(" ");
}

export function bikeDescription(identity) {
  const lines = [];
  if (identity?.marque) lines.push(`Marque: ${identity.marque}`);
  if (identity?.modele) lines.push(`Modele: ${identity.modele}`);
  if (identity?.version) lines.push(`Version: ${identity.version}`);
  if (identity?.annee) lines.push(`Annee: ${identity.annee}`);
  if (identity?.taille_roues) lines.push(`Taille de roues: ${identity.taille_roues}`);
  if (identity?.taille_cadre) lines.push(`Taille du cadre: ${identity.taille_cadre}`);
  if (isJuniorBike(identity)) lines.push("Categorie: velo junior/enfant (roues 14-24 pouces)");
  return lines.length ? lines.join("\n") : "(velo non identifie)";
}

export function searchQuerySuffix(identity) {
  const size = wheelSizeInches(identity);
  if (size === null) return "";
  if (size >= 14 && size <= 24) {
    const label = Number.isInteger(size) ? String(Math.trunc(size)) : String(size);
    return ` "${label} pouces" junior enfant`;
  }
  return "";
}

export function getManufacturerDomain(identity) {
  const brand = normalizeSpace(identity?.marque || "").toLowerCase();
  if (!brand) return null;
  if (MANUFACTURER_DOMAINS[brand]) return MANUFACTURER_DOMAINS[brand];
  for (const part of brand.split(/[/,]/).map((s) => s.trim()).filter(Boolean)) {
    if (MANUFACTURER_DOMAINS[part]) return MANUFACTURER_DOMAINS[part];
  }
  return null;
}

export function sourceProfileForUrl(url, identity) {
  let domain = "";
  try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { return { name: "Autre", domain: "", priority: 999, type: "other" }; }
  const manuf = getManufacturerDomain(identity || {});
  if (manuf && domain.endsWith(manuf)) return { name: "Constructeur", domain: manuf, priority: 10, type: "manufacturer" };
  for (const r of KNOWN_RETAILERS) if (domain.endsWith(r.domain)) return { name: r.name, domain: r.domain, priority: 15, type: "retailer" };
  // Revendeur de reconditionne / occasion (Upway, Buycycle, etc.) : prix DEJA décotés,
  // ne sert pas de référence neuf. On les classe en 'refurbisher'.
  // Match regex pour gerer les TLD multiples (upway.fr / upway.com / upway.de...)
  for (const r of KNOWN_REFURBISHERS) {
    const matches = r.match ? r.match.test(domain) : (r.domain && domain.endsWith(r.domain));
    if (matches) return { name: r.name, domain, priority: 50, type: "refurbisher" };
  }
  for (const p of PRICE_SOURCE_PROFILES) if (domain.endsWith(p.domain)) return { ...p, type: "magazine" };
  return { name: "Autre", domain, priority: 999, type: "other" };
}

export const IDENTITY_SCHEMA = {
  type: "object",
  properties: {
    marque: { type: ["string", "null"] },
    modele: { type: ["string", "null"] },
    version: { type: ["string", "null"] },
    annee: { type: ["integer", "null"] },
    taille_roues: { type: ["string", "null"], enum: [...ALLOWED_WHEEL_SIZES, null] },
    taille_cadre: { type: ["string", "null"], enum: ["XS", "S", "M", "L", "XL", "XXL", null] },
    electric: { type: ["boolean", "null"] },
  },
  required: ["marque", "modele", "version", "annee", "taille_roues", "taille_cadre", "electric"],
  additionalProperties: false,
};

export function buildIdentityPrompt(adText) {
  const truncated = String(adText || "").slice(0, 4000);
  return `Tu extrais l'identite d'un velo a partir d'une annonce d'occasion.

Reponds UNIQUEMENT en JSON strict, conforme au schema impose :
- marque (ex: Orbea, Specialized, Trek, Commencal, Decathlon...) ou null
- modele (ex: Rallon, Stumpjumper, Slash, Clash...) ou null
- version (ex: M-Team, S-Works, H10, Comp, Expert, AXS, ...) ou null
- annee (entier, 2000-2026) ou null
- taille_roues : un de "12","14","16","18","20","24","26","27.5","28","29" ou null
- taille_cadre : un de "XS","S","M","L","XL","XXL" ou null
- electric : true (VAE/ebike), false (musculaire), null si inconnu

Si une info manque, mets null. Ne devine pas.

ANNONCE :
"""
${truncated}
"""`;
}

export function postProcessIdentity(data, adText, attributes = {}) {
  const out = { ...data };
  const text = String(adText || "");
  const lower = text.toLowerCase();

  if (!out.annee) {
    const m = text.match(/\b(20[0-3]\d)\b/);
    if (m) out.annee = parseInt(m[1], 10);
  }

  if (!out.taille_roues) {
    const attrWheel = String(attributes.bicycle_wheel_size || "");
    const wm = attrWheel.match(/(\d{2}(?:[.,]\d)?)/);
    if (wm) {
      const norm = wm[1].replace(",", ".");
      if (ALLOWED_WHEEL_SIZES.includes(norm)) out.taille_roues = norm;
    } else {
      const m2 = lower.match(/(?<!\d)(\d{2}(?:[.,]\d)?)\s*(?:pouces|"|''|po\b)/);
      if (m2) {
        const norm = m2[1].replace(",", ".");
        if (ALLOWED_WHEEL_SIZES.includes(norm)) out.taille_roues = norm;
      }
    }
  }

  if (!out.taille_cadre) {
    const attrFrame = String(attributes.bicycle_size || "").toUpperCase();
    if (["XS", "S", "M", "L", "XL", "XXL"].includes(attrFrame)) out.taille_cadre = attrFrame;
    else {
      const m3 = text.match(/\b(?:taille|cadre|en)\s+(XS|S|M|L|XL|XXL)\b/i);
      if (m3) out.taille_cadre = m3[1].toUpperCase();
    }
  }

  if (!out.version) {
    const tier = detectVariantTier(text);
    if (tier) out.version = tier;
  }

  const elec = detectElectric(text, attributes);
  if (elec !== null) out.electric = elec;

  return out;
}

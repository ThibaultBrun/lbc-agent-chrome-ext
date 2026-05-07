// Identite voiture : marque, modele, finition, motorisation, energie, boite,
// annee, kilometrage, controle technique, proprietaires, couleur, options.
// Tres complet pour permettre une cote precise (km + motorisation = ecart enorme).

import { normalizeSpace } from "../../core/utils.js";
import {
  MANUFACTURER_DOMAINS,
  PRICE_SOURCE_PROFILES,
  KNOWN_RETAILERS,
  KNOWN_REFURBISHERS,
  RELIABILITY_SOURCES,
  TRIM_TIERS,
  FUEL_TYPES,
  GEARBOX_TYPES,
} from "./catalog.js";

export const IDENTITY_SCHEMA = {
  type: "object",
  properties: {
    marque: { type: ["string", "null"] },
    modele: { type: ["string", "null"] },
    finition: { type: ["string", "null"] },           // "Allure", "GT Line", "S Line", etc.
    annee: { type: ["integer", "null"], minimum: 1990, maximum: 2030 },
    motorisation: { type: ["string", "null"] },       // "1.5 BlueHDi 130", "TDI 150", "TFSI 245"
    cylindree_cc: { type: ["integer", "null"], minimum: 600, maximum: 8000 },
    puissance_ch: { type: ["integer", "null"], minimum: 30, maximum: 1000 },
    puissance_fiscale: { type: ["integer", "null"], minimum: 1, maximum: 60 },
    energie: {
      type: ["string", "null"],
      enum: ["essence", "diesel", "hybride", "hybride rechargeable", "electrique", "gpl", "ethanol", null],
    },
    boite: {
      type: ["string", "null"],
      enum: ["manuelle", "automatique", "robotisee", "semi-automatique", null],
    },
    nb_vitesses: { type: ["integer", "null"], minimum: 4, maximum: 10 },
    transmission: { type: ["string", "null"] },       // "4x2", "4x4", "intégrale"
    kilometrage_km: { type: ["integer", "null"], minimum: 0, maximum: 1000000 },
    nb_proprietaires: { type: ["integer", "null"], minimum: 1, maximum: 20 },
    controle_technique: { type: ["string", "null"] }, // "ok", "à faire", "vierge"
    premiere_main: { type: ["boolean", "null"] },
    couleur: { type: ["string", "null"] },
    nb_portes: { type: ["integer", "null"], minimum: 2, maximum: 5 },
    nb_places: { type: ["integer", "null"], minimum: 2, maximum: 9 },
    options: { type: "array", items: { type: "string", maxLength: 100 }, maxItems: 20 },
  },
  required: ["marque", "modele", "annee", "energie", "kilometrage_km"],
  additionalProperties: false,
};

export function buildIdentityPrompt(adText) {
  const truncated = String(adText || "").slice(0, 4000);
  return `Tu extrais l'identite d'une voiture a partir d'une annonce d'occasion.

Reponds UNIQUEMENT en JSON strict, conforme au schema impose :
- marque (Peugeot, Renault, BMW, Audi, VW, Tesla...) ou null
- modele (308, Clio, Serie 3, A4, Golf, Model 3...) ou null
- finition (Allure, GT Line, S Line, Sport...) ou null
- annee (entier 1990-2030, premiere immatriculation/mise en circulation) ou null
- motorisation (ex: "1.5 BlueHDi 130", "TDI 150", "TFSI 245") ou null
- cylindree_cc (entier en cm³, ex: 1499 pour 1.5L) ou null
- puissance_ch (chevaux DIN entier) ou null
- puissance_fiscale (CV fiscaux entier 1-60) ou null
- energie : 'essence' | 'diesel' | 'hybride' | 'hybride rechargeable' | 'electrique' | 'gpl' | 'ethanol' | null
- boite : 'manuelle' | 'automatique' | 'robotisee' | 'semi-automatique' | null
- nb_vitesses (entier 4-10) ou null
- transmission ('4x2', '4x4', 'intégrale') ou null
- kilometrage_km (entier en km) ou null
- nb_proprietaires (entier) ou null
- controle_technique ('ok', 'à faire', 'vierge', etc.) ou null
- premiere_main (booleen) ou null
- couleur ou null
- nb_portes / nb_places (entier) ou null
- options (liste d'equipements pertinents : "GPS", "Toit ouvrant", "Caméra de recul",
  "Sieges chauffants", "Hayon electrique", "Apple CarPlay", etc.) — ne pas inventer

Si une info manque, mets null. Ne devine pas.

ANNONCE :
"""
${truncated}
"""`;
}

// Post-process : exploite les attributs LBC structures (souvent fiables)
export function postProcessIdentity(data, adText, attributes = {}) {
  const out = { ...data };
  const text = String(adText || "");
  const lower = text.toLowerCase();

  // Annee : attributs LBC -> regex
  if (!out.annee) {
    const attrRegYear = parseInt(attributes.regdate || attributes.year || "", 10);
    if (attrRegYear >= 1990 && attrRegYear <= 2030) out.annee = attrRegYear;
    else {
      const m = text.match(/\b(19[89]\d|20[0-3]\d)\b/);
      if (m) out.annee = parseInt(m[1], 10);
    }
  }

  // Kilometrage : attributs LBC en priorite
  if (!out.kilometrage_km) {
    const attrKm = parseInt(String(attributes.mileage || "").replace(/[^\d]/g, ""), 10);
    if (attrKm > 0 && attrKm < 1_000_000) out.kilometrage_km = attrKm;
    else {
      // Regex texte : "150000 km" ou "150 000 km"
      const m = text.match(/\b(\d{1,3}(?:[ .]\d{3})*)\s*km\b/i);
      if (m) {
        const n = parseInt(m[1].replace(/[ .]/g, ""), 10);
        if (n > 1000 && n < 1_000_000) out.kilometrage_km = n;
      }
    }
  }

  // Energie : attribut LBC fuel
  if (!out.energie) {
    const fuel = String(attributes.fuel || "").toLowerCase();
    for (const f of FUEL_TYPES) {
      if (fuel.includes(f)) { out.energie = f; break; }
    }
  }

  // Boite : attribut LBC gearbox
  if (!out.boite) {
    const gb = String(attributes.gearbox || "").toLowerCase();
    if (gb.includes("manuel")) out.boite = "manuelle";
    else if (gb.includes("auto")) out.boite = "automatique";
    else if (gb.includes("robot")) out.boite = "robotisee";
  }

  // Puissance fiscale (LBC : horsepower / vehicle_horsepower)
  if (!out.puissance_fiscale) {
    const hp = parseInt(attributes.horse_power || attributes.vehicle_horsepower || "", 10);
    if (hp > 0 && hp < 60) out.puissance_fiscale = hp;
  }

  // Couleur LBC : vehicule_color
  if (!out.couleur && attributes.vehicule_color) {
    out.couleur = String(attributes.vehicule_color);
  }

  // Marque/modele : attribut LBC souvent fiable
  if (!out.marque && attributes.brand) out.marque = String(attributes.brand);
  if (!out.modele && attributes.model) out.modele = String(attributes.model);

  // Finition : si non extraite, regex sur le texte avec TRIM_TIERS
  if (!out.finition) {
    for (const tier of TRIM_TIERS) {
      const re = new RegExp(`(?<![a-z])${tier.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "i");
      if (re.test(lower)) { out.finition = tier; break; }
    }
  }

  return out;
}

// Compactage pour les requetes web : marque + modele + (finition) + annee
export function compactIdentity(identity, includeFinition = true) {
  const parts = [
    identity?.marque,
    identity?.modele,
    includeFinition ? identity?.finition : null,
    identity?.annee ? String(identity.annee) : null,
  ].filter(Boolean);
  return parts.join(" ");
}

// Compactage avec motorisation pour les queries fiabilite
export function compactIdentityWithMotor(identity) {
  const base = compactIdentity(identity, false);
  const motor = identity?.motorisation;
  return motor ? `${base} ${motor}` : base;
}

export function autoDescription(identity) {
  const lines = [];
  if (identity?.marque) lines.push(`Marque: ${identity.marque}`);
  if (identity?.modele) lines.push(`Modele: ${identity.modele}`);
  if (identity?.finition) lines.push(`Finition: ${identity.finition}`);
  if (identity?.annee) lines.push(`Annee: ${identity.annee}`);
  if (identity?.motorisation) lines.push(`Motorisation: ${identity.motorisation}`);
  if (identity?.energie) lines.push(`Energie: ${identity.energie}`);
  if (identity?.boite) lines.push(`Boite: ${identity.boite}`);
  if (identity?.kilometrage_km) lines.push(`Kilometrage: ${identity.kilometrage_km} km`);
  return lines.length ? lines.join("\n") : "(voiture non identifiee)";
}

export function getManufacturerDomain(identity) {
  const brand = normalizeSpace(identity?.marque || "").toLowerCase();
  if (!brand) return null;
  if (MANUFACTURER_DOMAINS[brand]) return MANUFACTURER_DOMAINS[brand];
  for (const part of brand.split(/[/,\s]+/).map((s) => s.trim()).filter(Boolean)) {
    if (MANUFACTURER_DOMAINS[part]) return MANUFACTURER_DOMAINS[part];
  }
  return null;
}

// Profile une URL : constructeur / retailer / refurbisher / magazine / reliability / other
export function sourceProfileForUrl(url, identity) {
  let domain = "";
  try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { return { name: "Autre", domain: "", priority: 999, type: "other" }; }
  const manuf = getManufacturerDomain(identity || {});
  if (manuf && domain.endsWith(manuf)) return { name: "Constructeur", domain: manuf, priority: 10, type: "manufacturer" };
  for (const r of KNOWN_RETAILERS) if (domain.endsWith(r.domain)) return { name: r.name, domain: r.domain, priority: 15, type: "retailer" };
  for (const r of KNOWN_REFURBISHERS) {
    const matches = r.match ? r.match.test(domain) : (r.domain && domain.endsWith(r.domain));
    if (matches) return { name: r.name, domain, priority: 30, type: "refurbisher" };
  }
  for (const p of RELIABILITY_SOURCES) if (domain.endsWith(p.domain)) return { ...p, type: "reliability" };
  for (const p of PRICE_SOURCE_PROFILES) if (domain.endsWith(p.domain)) return { ...p, type: "magazine" };
  return { name: "Autre", domain, priority: 999, type: "other" };
}

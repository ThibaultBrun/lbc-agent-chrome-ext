// Extraction de caracteristiques techniques d'un velo depuis les pages
// constructeur / magazine deja fetchees pour les prix.
// Schema oriente "interets riders" : debattement, geometrie, poids, transmission,
// suspension, freins, roues, motorisation (VAE).

import { extractPriceContext } from "../../core/pages.js";
import { bikeDescription } from "./identity.js";

export const BIKE_SPECS_SCHEMA = {
  type: "object",
  properties: {
    travel_front_mm: { type: ["integer", "null"], minimum: 0, maximum: 250 },
    travel_rear_mm: { type: ["integer", "null"], minimum: 0, maximum: 250 },
    geometry: {
      type: "object",
      properties: {
        reach_mm: { type: ["integer", "null"], minimum: 350, maximum: 600 },
        stack_mm: { type: ["integer", "null"], minimum: 500, maximum: 700 },
        head_angle_deg: { type: ["number", "null"], minimum: 60, maximum: 80 },
        seat_angle_deg: { type: ["number", "null"], minimum: 60, maximum: 90 },
        chainstay_mm: { type: ["integer", "null"], minimum: 380, maximum: 500 },
        wheelbase_mm: { type: ["integer", "null"], minimum: 1000, maximum: 1400 },
        bb_drop_mm: { type: ["integer", "null"], minimum: -10, maximum: 60 },
        toptube_mm: { type: ["integer", "null"], minimum: 400, maximum: 700 },
      },
      additionalProperties: false,
    },
    weight_kg: { type: ["number", "null"], minimum: 5, maximum: 35 },
    drivetrain: { type: ["string", "null"] },          // "Shimano XT 12V", "SRAM GX AXS", ...
    chainring_count: { type: ["integer", "null"], minimum: 1, maximum: 3 },
    cassette: { type: ["string", "null"] },            // "10-51"
    brakes: { type: ["string", "null"] },              // "Magura MT7", "Shimano XT 4-piston", ...
    rotor_size_front: { type: ["string", "null"] },    // "203mm"
    rotor_size_rear: { type: ["string", "null"] },
    fork: { type: ["string", "null"] },                // "Fox 38 Factory 170mm"
    rear_shock: { type: ["string", "null"] },          // "Fox X2 Factory"
    wheelset: { type: ["string", "null"] },            // "DT Swiss XM1700"
    tires_front: { type: ["string", "null"] },
    tires_rear: { type: ["string", "null"] },
    dropper_post: { type: ["string", "null"] },        // "OneUp 180mm"
    handlebar_width_mm: { type: ["integer", "null"], minimum: 600, maximum: 850 },
    // VAE
    motor: { type: ["string", "null"] },               // "Bosch Performance CX", "Shimano EP801"
    motor_torque_nm: { type: ["integer", "null"], minimum: 0, maximum: 120 },
    battery_wh: { type: ["integer", "null"], minimum: 0, maximum: 1000 },
    range_km_eco: { type: ["integer", "null"], minimum: 0, maximum: 300 },
  },
  additionalProperties: false,
};

export function buildSpecsExtractionPrompt(identity, pageText, sourceUrl, sourceProfile) {
  const desc = bikeDescription(identity);
  const sname = sourceProfile?.name || "?";
  const stype = sourceProfile?.type || "other";
  const excerpt = extractSpecsContext(pageText);

  return `Velo cible:
${desc}
Source: ${sourceUrl} (${sname}, ${stype})

Voici des extraits d'une page produit ou test produit. Extrais UNIQUEMENT les
caracteristiques techniques qui correspondent au velo cible (meme marque, meme
modele, meme version si dispo, meme taille de roues).

REGLES CRITIQUES :
- Beaucoup de modeles ont PLUSIEURS variantes (ex: Scott Genius 940 / 930 / 920 /
  Tuned / Plus). Une fiche peut decrire la version HAUT DE GAMME (Tuned) avec
  des composants Fox Factory, alors que la version cible (940) est l'entree de
  gamme avec composants Marzocchi/X-Fusion. Si tu n'es PAS SUR a 100% que la
  spec correspond a la VERSION EXACTE du velo cible, mets null.
- Privilegie le DOUTE : mets null plutot que d'inventer.
- Pas de copy-paste de specs depuis une autre version du meme modele. JAMAIS.

REGLES :
- Tous les champs sont OPTIONNELS. Mets null si l'info n'est pas presente OU
  ambigue (plusieurs valeurs sans pouvoir trancher).
- Debattement (travel) : en millimetres. Avant = fork, arriere = rear shock.
- Geometrie : valeurs pour la TAILLE moyenne du velo (M par defaut), seulement
  si la taille de cadre cible est mentionnee.
- Poids en kg (number). Pour un VAE c'est typiquement 18-25 kg.
- Drivetrain = transmission complete style "Shimano XT 12V" ou "SRAM GX Eagle Transmission".
- Brakes = etriers + nb pistons style "Magura MT7 4 pistons" ou "Shimano XT 4-piston".
- Fork = marque + modele + travel "Fox 38 Factory 170mm".
- Motor (VAE uniquement) : "Bosch Performance CX", "Shimano EP801", "Specialized 2.2".
- Battery_wh : capacite batterie en Wh (entier).

Reponds en JSON strict, conforme au schema, FRANCAIS pour les valeurs textuelles
quand c'est applicable.

Extraits :
"""
${excerpt.slice(0, 8000)}
"""`;
}

// Fenetre de contexte specs : on cible les sections geometrie / specs / fiche tech
function extractSpecsContext(text, maxLen = 8000) {
  if (!text) return "";
  // Mots-cles qui signalent une section technique
  const keywords = /\b(geometr|reach|stack|d[ée]battement|travel|head angle|seat angle|chainstay|wheelbase|poids|weight|drivetrain|transmission|cassette|frein|brake|fourche|fork|rear shock|amortisseur|moteur|motor|batterie|battery|wh|nm|tube top|toptube|bb drop|chainring)/i;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = [];
  let len = 0;
  for (const s of sentences) {
    if (keywords.test(s)) {
      kept.push(s);
      len += s.length;
      if (len > maxLen) break;
    }
  }
  if (kept.length) return kept.join(" ");
  return text.slice(0, maxLen);
}

// Fusionne plusieurs objets specs en un seul, en preferant les sources les
// plus fiables (constructeur > magazine > retailer). Pour chaque champ, on
// garde la 1re valeur non-null en suivant l'ordre des sources.
export function mergeSpecs(specsArray) {
  const merged = {};
  for (const { specs, profile } of specsArray) {
    if (!specs) continue;
    for (const k of Object.keys(specs)) {
      if (k === "geometry" && specs.geometry) {
        merged.geometry = merged.geometry || {};
        for (const gk of Object.keys(specs.geometry)) {
          if (specs.geometry[gk] != null && merged.geometry[gk] == null) {
            merged.geometry[gk] = specs.geometry[gk];
          }
        }
      } else if (specs[k] != null && merged[k] == null) {
        merged[k] = specs[k];
      }
    }
  }
  return Object.keys(merged).length ? merged : null;
}

// Priorite des sources pour la fiabilite des specs (constructeur d'abord)
export function specsSourcePriority(profileType) {
  switch (profileType) {
    case "manufacturer": return 1;
    case "magazine": return 2;
    case "retailer": return 3;
    case "refurbisher": return 4;
    default: return 99;
  }
}

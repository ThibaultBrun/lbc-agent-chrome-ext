// Prompt d'extraction de prix sur une page produit — spécifique vélo
// (hint manufacturer/retailer/magazine, junior).
// Le schéma JSON et le helper extractPriceContext viennent de core/pages.js.

import { extractPriceContext } from "../../core/pages.js";
import { bikeDescription, isJuniorBike } from "./identity.js";

export function buildPriceExtractionPrompt(identity, pageText, sourceUrl, sourceProfile) {
  const desc = bikeDescription(identity);
  const sp = sourceProfile || {};
  const stype = sp.type || "other";
  const sname = sp.name || "?";
  let hint = "";
  if (stype === "manufacturer") {
    hint = `\nSOURCE TYPE: site CONSTRUCTEUR (${sname}). REGLE STRICTE: kind = 'msrp' (catalogue) ou 'sale' (promo). Jamais 'retail' sur un constructeur.\n`;
  } else if (stype === "retailer") {
    hint = `\nSOURCE TYPE: gros revendeur en ligne de NEUF (${sname}). Le prix de vente actuel = 'retail'. Si un prix est barre = 'msrp'. Si promo explicite = 'sale'.\n`;
  } else if (stype === "refurbisher") {
    hint = `\nSOURCE TYPE: revendeur d'OCCASION/RECONDITIONNE (${sname}, type Upway/Buycycle/MyVeloShop). Tous les prix = 'used'. JAMAIS 'retail' ni 'msrp' (les vehicules sont d'occasion, prix deja decotes).\n`;
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

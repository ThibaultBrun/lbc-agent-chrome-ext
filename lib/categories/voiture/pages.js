// Prompt d'extraction de prix sur une page produit/cote — specifique voiture.
// Le schema PRICE_EXTRACTION_SCHEMA et extractPriceContext viennent de core/pages.js.

import { extractPriceContext } from "../../core/pages.js";
import { autoDescription } from "./identity.js";

export function buildPriceExtractionPrompt(identity, pageText, sourceUrl, sourceProfile) {
  const desc = autoDescription(identity);
  const sp = sourceProfile || {};
  const stype = sp.type || "other";
  const sname = sp.name || "?";
  let hint = "";
  if (stype === "manufacturer") {
    hint = `\nSOURCE TYPE: site CONSTRUCTEUR (${sname}). REGLE STRICTE: kind = 'msrp' (catalogue actuel ou tarif a la sortie du modele) ou 'sale' (promo). Jamais 'retail' sur un constructeur.\n`;
  } else if (stype === "retailer") {
    hint = `\nSOURCE TYPE: mandataire / concession multimarque (${sname}). Le prix de vente actuel = 'retail'. Si un prix est barre = 'msrp'. Si remise/promo explicite = 'sale'.\n`;
  } else if (stype === "refurbisher") {
    hint = `\nSOURCE TYPE: agregateur d'OCCASION (${sname}, type AutoScout24/Reezocar/Heycar). Tous les prix = 'used'. JAMAIS 'retail' ni 'msrp' (les vehicules sont d'occasion).\n`;
  } else if (stype === "magazine") {
    hint = `\nSOURCE TYPE: magazine / cote (${sname}, ex Argus/Caradisiac/Auto Plus). Selon le contexte :
- Prix de la cote occasion = 'used'
- Prix neuf catalogue = 'msrp'
- Prix neuf actuel mandataire = 'retail'
Lis le contexte autour du prix pour decider.\n`;
  } else if (stype === "reliability") {
    hint = `\nSOURCE TYPE: source FIABILITE (${sname}). On ne s'attend pas a des prix sur ces pages, mets [] si pas de prix clair sur le modele cible.\n`;
  }
  const excerpt = extractPriceContext(pageText);
  return `Voiture cible :
${desc}
Source: ${sourceUrl}${hint}
Voici des extraits d'une page web autour de mentions de prix. Identifie UNIQUEMENT
les prix qui correspondent a la voiture cible (meme marque, meme modele, meme
motorisation si mentionnee, generation similaire). Pas les prix d'options seules,
pas les prix d'autres modeles, pas les prix d'accessoires.

Pour chaque prix retenu :
- amount_eur : montant entier en euros (PAS le prix mensuel d'un leasing : multiplie
  ou ignore. Le prix vehicule est typiquement entre 1000 et 200000 EUR).
- kind : 'msrp' (catalogue constructeur) | 'retail' (mandataire neuf) | 'current' (prix
  courant constate) | 'used' (cote occasion) | 'sale' (promo/remise explicite)
- context : 1-15 mots de contexte (ex: 'cote Argus 2020 100k km', 'prix neuf Aramis avec remise')

Reponds en JSON strict {"prices": [...]}.

Extraits :
"""
${excerpt.slice(0, 6000)}
"""`;
}

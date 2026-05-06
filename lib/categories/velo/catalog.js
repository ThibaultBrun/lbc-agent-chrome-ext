// Catalogue spécifique vélo : domaines constructeurs, revendeurs, magazines,
// sources de comparables, taille de roues admises, mots-clés VAE.

export const MANUFACTURER_DOMAINS = {
  bmc: "bmc-switzerland.com",
  cannondale: "cannondale.com",
  canyon: "canyon.com",
  commencal: "commencal.com",
  cube: "cube.eu",
  decathlon: "decathlon.fr",
  focus: "focus-bikes.com",
  ghost: "ghost-bikes.com",
  giant: "giant-bicycles.com",
  haibike: "haibike.com",
  kona: "konaworld.com",
  ktm: "ktm-bikes.at",
  lapierre: "lapierrebikes.com",
  marin: "marinbikes.com",
  megamo: "megamo.com",
  mondraker: "mondraker.com",
  norco: "norco.com",
  orbea: "orbea.com",
  pivot: "pivotcycles.com",
  propain: "propain-bikes.com",
  radon: "radon-bikes.de",
  rockrider: "decathlon.fr",
  "rocky mountain": "bikes.com",
  "santa cruz": "santacruzbicycles.com",
  scott: "scott-sports.com",
  specialized: "specialized.com",
  sunn: "sunn.fr",
  trek: "trekbikes.com",
  transition: "transitionbikes.com",
  vitus: "vitusbikes.com",
  yeti: "yeticycles.com",
  yt: "yt-industries.com",
};

// Revendeurs de NEUF (kind='retail' valide). Ne pas confondre avec les
// revendeurs de reconditionne / occasion (cf KNOWN_REFURBISHERS).
export const KNOWN_RETAILERS = [
  { name: "Alltricks", domain: "alltricks.fr" },
  { name: "Probikeshop", domain: "probikeshop.fr" },
  { name: "Bike-Discount", domain: "bike-discount.de" },
  { name: "Bike24", domain: "bike24.com" },
  { name: "Bike-Components", domain: "bike-components.de" },
  { name: "Starbike", domain: "starbike.com" },
  { name: "Mantel", domain: "mantel.com" },
  { name: "Bikester", domain: "bikester.fr" },
  { name: "Cyclable", domain: "cyclable.com" },
  { name: "Materiel-Velo", domain: "materiel-velo.com" },
  { name: "Lecyclo", domain: "lecyclo.com" },
  { name: "Wiggle", domain: "wiggle.com" },
  { name: "Chain Reaction Cycles", domain: "chainreactioncycles.com" },
  { name: "Tredz", domain: "tredz.co.uk" },
  { name: "Hibike", domain: "hibike.com" },
  { name: "Rose Bikes", domain: "rosebikes.fr" },
];

// Revendeurs de reconditionne / occasion (kind='used' accepte, retail downgrade).
// Souvent ex-location ou flotte pro. Prix deja decotes, ne pas re-decoter.
// On match sur le keyword DANS le hostname (pas seulement endsWith) pour gerer
// les variantes .fr/.com/.de/.eu et les sous-domaines pays.
export const KNOWN_REFURBISHERS = [
  { name: "Upway", match: /(^|\.)upway\.(fr|com|de|eu|nl|be|es|it)$/i },
  { name: "Buycycle", match: /(^|\.)buycycle\.(com|fr|de|eu|nl)$/i },
  { name: "MyVeloShop", match: /(^|\.)myveloshop\.(com|fr|de)$/i },
  { name: "Rebike", match: /(^|\.)rebike(1)?\.(com|de|fr|eu)$/i },
  { name: "MINT-Bikes", match: /(^|\.)mint-bikes\.(com|de|fr|eu)$/i },
  { name: "Tones Of Bikes", match: /(^|\.)tonesofbikes\.(com|fr)$/i },
  { name: "Bikeflip", match: /(^|\.)bikeflip\.(com|fr|de|eu|nl)$/i },
  { name: "Cycleur de Luxe", match: /(^|\.)cycleurdeluxe\.(com|fr)$/i },
  { name: "Vélo Vintage", match: /(^|\.)velo-vintage\.(com|fr)$/i },
];

export const PRICE_SOURCE_PROFILES = [
  { name: "Velo Vert", domain: "velovert.com", priority: 20 },
  { name: "Big Bike Magazine", domain: "bigbike-magazine.com", priority: 30 },
  { name: "26in", domain: "26in.fr", priority: 40 },
  { name: "Pinkbike", domain: "pinkbike.com", priority: 50 },
  { name: "Bike Magazine", domain: "bike-magazine.com", priority: 60 },
  { name: "Vital MTB", domain: "vitalmtb.com", priority: 70 },
  { name: "99 Spokes", domain: "99spokes.com", priority: 80 },
  { name: "MTB Database", domain: "mtbdatabase.com", priority: 90 },
];

// Sources occasion à exclure du search web (déjà couvertes par les comparables)
export const EXTRA_EXCLUDED_DOMAINS = ["troc-velo.com"];

export const VARIANT_TIERS = [
  "S-Works", "Pro AXS", "Pro Carbon", "Pro", "Expert", "Comp", "Alloy", "Frameset",
  "M-Team", "M-LTD", "M10", "M20", "M30", "M-LR",
  "H10", "H20", "H30",
  "Master", "Team", "LTD", "Race", "Limited",
  "AXS", "GX", "X01", "XX1", "XTR",
];

export const ELECTRIC_KEYWORDS = [
  "vae", "vttae", "vtteae", "v.a.e.", "vtt electrique", "velo electrique",
  "vtt e-bike", "ebike", "e-bike", "e-mtb", "emtb", "electric bike",
  "vtt assistance electrique", "assistance electrique", "moteur electrique",
  "bosch cx", "bosch sx", "performance line", "active line",
  "shimano ep8", "shimano ep801", "ep801", " ep8 ", "shimano steps",
  "brose s mag", "brose drive",
  "yamaha pwx", "yamaha pw",
  "specialized sl", "fazua", "tq hpr50", "polini", "panasonic",
  "orbea rise", "orbea wild", "orbea kemen",
  "specialized levo", "specialized kenevo", "specialized vado", "specialized turbo",
  "trek rail", "trek powerfly", "trek fuel exe",
  "scott patron", "scott genius eride", "scott strike eride",
  "cube stereo hybrid", "cube reaction hybrid",
  "haibike sduro", "haibike xduro", "haibike alltrack",
  "moustache samedi", "moustache lundi", "moustache j",
  "decathlon stilus", "rockrider e-",
  "canyon spectral on", "canyon strive on",
  "lapierre overvolt",
  " wh", "watts heure", "watts-heure",
  "540 wh", "625 wh", "630 wh", "720 wh", "750 wh", "800 wh",
];

export const NON_ELECTRIC_HINTS = [" musculaire", "vtt musculaire", "non electrique", "sans assistance"];

export const ALLOWED_WHEEL_SIZES = ["12", "14", "16", "18", "20", "24", "26", "27.5", "28", "29"];

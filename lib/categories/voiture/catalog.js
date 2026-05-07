// Catalogue spécifique voiture : domaines constructeurs, revendeurs neuf,
// comparateurs cote, agregateurs occasion, magazines.

// Constructeurs auto (FR + Europe + Premium + Asie majoritairement vendus en France)
export const MANUFACTURER_DOMAINS = {
  // FR
  peugeot: "peugeot.fr",
  renault: "renault.fr",
  citroen: "citroen.fr",
  ds: "dsautomobiles.fr",
  // DE
  volkswagen: "volkswagen.fr",
  vw: "volkswagen.fr",
  audi: "audi.fr",
  bmw: "bmw.fr",
  mercedes: "mercedes-benz.fr",
  "mercedes-benz": "mercedes-benz.fr",
  porsche: "porsche.com",
  opel: "opel.fr",
  // ES / IT
  seat: "seat.fr",
  cupra: "cupra.fr",
  fiat: "fiat.fr",
  alfa: "alfaromeo.fr",
  "alfa romeo": "alfaromeo.fr",
  // CZ
  skoda: "skoda.fr",
  // SE
  volvo: "volvocars.com",
  // GB
  jaguar: "jaguar.fr",
  "land rover": "landrover.fr",
  "range rover": "landrover.fr",
  mini: "mini.fr",
  // JP
  toyota: "toyota.fr",
  nissan: "nissan.fr",
  honda: "honda.fr",
  mazda: "mazda.fr",
  subaru: "subaru.fr",
  suzuki: "suzuki.fr",
  // KR
  hyundai: "hyundai.fr",
  kia: "kia.fr",
  // EV pure-play
  tesla: "tesla.com",
  byd: "bydauto.fr",
  mg: "mgmotor.eu",
  polestar: "polestar.com",
  // US
  ford: "ford.fr",
  jeep: "jeep.fr",
  dodge: "dodge.com",
  // Autres
  dacia: "dacia.fr",
  smart: "smart.com",
};

// Revendeurs neuf / mandataires (concessions multimarques en ligne)
export const KNOWN_RETAILERS = [
  { name: "Aramis Auto", domain: "aramisauto.com" },
  { name: "Promo Neuve Auto", domain: "promoneuveauto.com" },
  { name: "Auto IES", domain: "autoies.com" },
  { name: "Auto Discount", domain: "autodiscount.fr" },
  { name: "Elite Auto", domain: "eliteauto.fr" },
  { name: "ClubAuto", domain: "clubauto.com" },
  { name: "Auto JM", domain: "autojm.fr" },
];

// Comparateurs / cote occasion (l'equivalent des magazines pour le velo, mais
// avec aussi des prix de marche). On les classe en 'magazine' au niveau type.
export const PRICE_SOURCE_PROFILES = [
  { name: "L'Argus", domain: "largus.fr", priority: 10 },
  { name: "La Centrale", domain: "lacentrale.fr", priority: 12 },
  { name: "Caradisiac", domain: "caradisiac.com", priority: 20 },
  { name: "Auto Plus", domain: "autoplus.fr", priority: 30 },
  { name: "Le Moniteur Automobile", domain: "moniteurautomobile.be", priority: 40 },
  { name: "Auto Journal", domain: "autojournal.fr", priority: 50 },
  { name: "Turbo.fr", domain: "turbo.fr", priority: 60 },
  { name: "Largus Pro", domain: "largus-pro.com", priority: 70 },
];

// Agregateurs occasion (equivalent refurbisher : ils vendent du d'occasion deja
// decotee). On les classe en 'refurbisher'.
export const KNOWN_REFURBISHERS = [
  { name: "AutoScout24", match: /(^|\.)autoscout24\.(fr|com|de|eu|nl|be|es|it)$/i },
  { name: "ParuVendu", match: /(^|\.)paruvendu\.fr$/i },
  { name: "LesAnonces.com", match: /(^|\.)lesanonces\.com$/i },
  { name: "Auto.fr", match: /(^|\.)auto\.fr$/i },
  { name: "Reezocar", match: /(^|\.)reezocar\.com$/i },
  { name: "Heycar", match: /(^|\.)heycar\.fr$/i },
  { name: "Spoticar", match: /(^|\.)spoticar\.fr$/i },
  { name: "RentauCar", match: /(^|\.)renault-occasions\.fr$/i },
];

// Sources occasion deja gerees ailleurs : a exclure du search web pour ne pas
// reboucler dessus depuis le pipeline web (les comparables en sont la source officielle).
export const EXTRA_EXCLUDED_DOMAINS = [];

// Sources de FIABILITE / pannes connues par modele+motorisation. Tres important
// en auto : la difference entre une bonne et une mauvaise affaire tient souvent
// a la motorisation (un 1.6 HDi 110 fiable vs un 2.0 BlueHDi 150 problematique).
export const RELIABILITY_SOURCES = [
  { name: "Fiches-Auto", domain: "fiches-auto.fr", priority: 5 },
  { name: "Auto-Moto", domain: "auto-moto.com", priority: 15 },
  { name: "Caradisiac Fiabilité", domain: "caradisiac.com", priority: 18 }, // articles fiabilite + forum
  { name: "Auto Plus Fiabilité", domain: "autoplus.fr", priority: 25 },
  { name: "Automobile-Magazine", domain: "automobile-magazine.fr", priority: 30 },
  { name: "TÜV Report FR", domain: "tuv-rapport.fr", priority: 35 },
  { name: "L'Automobile Magazine", domain: "lautomobile-magazine.fr", priority: 40 },
  { name: "Largus Fiabilité", domain: "largus.fr", priority: 45 }, // section fiabilite
];

// Energies courantes (pour mapping LBC attribute fuel)
export const FUEL_TYPES = ["essence", "diesel", "hybride", "hybride rechargeable", "electrique", "gpl", "ethanol"];

// Boites de vitesses
export const GEARBOX_TYPES = ["manuelle", "automatique", "robotisee", "semi-automatique"];

// Quelques tier/finitions courants (pour detectVariantTier auto, comme S-Works/H10 cote velo)
export const TRIM_TIERS = [
  // FR
  "GTI", "GTD", "GTE", "RS", "ST", "Cross", "Allure", "GT Line", "GT", "Tekna",
  "Edition", "Limited", "Premium", "Sport", "Sportline", "S Line", "M Sport",
  // Premium
  "AMG", "M Performance", "M3", "M4", "M5", "RS3", "RS4", "RS6", "RS7",
  "Quattro", "TFSI", "TDI", "Hybrid", "PHEV", "EV", "e-tron",
  // Generiques
  "Active", "Style", "Business", "Confort", "Elegance", "Exclusive",
  "Trendline", "Comfortline", "Highline", "R-Line",
  "Pack", "First Edition", "Initiale", "Prestige", "Signature",
];

// Constantes utilitaires (depuis bike-ia-agent on garde le meme spirit)
export const CURRENT_YEAR_AUTO = new Date().getFullYear();

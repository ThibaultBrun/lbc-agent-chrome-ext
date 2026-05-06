// Config partagée — port des constantes de bike_agent/config.py.
// Tout est statique, importable depuis n'importe quel module ES.

export const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

// Marques connues → domaine officiel constructeur (pour `site:` queries + classification)
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

export const EXCLUDED_RESULT_DOMAINS = [
  "leboncoin.fr",
  "leboncoin.com",
  "troc-velo.com",
];

// Throttle par domaine (intervalle min entre 2 requêtes, ms)
export const DOMAIN_MIN_INTERVAL_MS = {
  "duckduckgo.com": 8000,
  "lite.duckduckgo.com": 8000,
  "html.duckduckgo.com": 8000,
  "bing.com": 6000,
  "r.jina.ai": 3000,
  "s.jina.ai": 99000,
};

export const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

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

export const CURRENT_YEAR = new Date().getFullYear();

// Regex prix (port de PRICE_RE Python) — capture "1 234,56 €", "1234 EUR", etc.
export const PRICE_RE = /(?<!\d)(\d{1,3}(?:[ .]\d{3})*|\d{3,6})(?:[,.]\d{1,2})?\s*(?:€|eur|euros)(?![a-z])/gi;
export const PRICE_CONTEXT_RE = /(?:€|\beur\b|\beuros?\b)/i;

export const DEFAULT_SETTINGS = {
  llmMode: "auto",            // "auto" | "nano" | "ollama" | "webllm"
  ollamaUrl: "http://localhost:11434",
  ollamaExtractModel: "llama3.2:3b",
  ollamaSynthModel: "mistral:7b",
  webllmModel: "Llama-3.1-8B-Instruct-q4f32_1-MLC",
  fetchPages: true,
  maxWebResults: 6,
  enableLbcComparables: true,
  enableTrocVeloComparables: true,
  showOverlay: true,
  autoAnalyze: false,
};

// Quelques modèles WebLLM recommandés (model_id de prebuiltAppConfig)
export const WEBLLM_MODELS = [
  { id: "Llama-3.1-8B-Instruct-q4f32_1-MLC", label: "Llama 3.1 8B (qualité max, ~5 Go)" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B (rapide, ~2 Go)" },
  { id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC", label: "Mistral 7B Instruct (~4 Go)" },
  { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 7B Instruct (~4 Go)" },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi 3.5 mini (~2 Go)" },
];

// Constantes 100% génériques (HTTP, cache, throttle, prix génériques, settings).
// Tout ce qui est spécifique à une catégorie vit dans lib/categories/<cat>/.

export const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

// Domaines exclus des résultats web (ne pas reboucler sur LBC depuis LBC)
export const EXCLUDED_RESULT_DOMAINS_BASE = ["leboncoin.fr", "leboncoin.com"];

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

// Regex prix (capture "1 234,56 €", "1234 EUR", etc.) — utile à toute catégorie
export const PRICE_RE = /(?<!\d)(\d{1,3}(?:[ .]\d{3})*|\d{3,6})(?:[,.]\d{1,2})?\s*(?:€|eur|euros)(?![a-z])/gi;
export const PRICE_CONTEXT_RE = /(?:€|\beur\b|\beuros?\b)/i;

export const CURRENT_YEAR = new Date().getFullYear();

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

// Modèles WebLLM proposés
export const WEBLLM_MODELS = [
  { id: "Llama-3.1-8B-Instruct-q4f32_1-MLC", label: "Llama 3.1 8B (qualité max, ~5 Go)" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B (rapide, ~2 Go)" },
  { id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC", label: "Mistral 7B Instruct (~4 Go)" },
  { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 7B Instruct (~4 Go)" },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi 3.5 mini (~2 Go)" },
];

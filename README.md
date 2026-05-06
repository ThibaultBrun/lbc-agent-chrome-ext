# LBC Bike Analyzer

Extension Chrome (Manifest V3) qui analyse une annonce **vélo** Leboncoin avec un
pipeline multi-étapes inspiré de [bike-ia-agent](https://github.com/ThibaultBrun/bike-ia-agent) :

1. **Identité** — extraction structurée (marque, modèle, version, année, taille de roues, taille de cadre, électrique) via LLM
2. **Catalogue web** — recherche DuckDuckGo / Bing / Jina Reader → ranking LLM → extraction prix par revendeur (Alltricks, Bike-Discount, Probikeshop, sites constructeurs…)
3. **Comparables occasion** — recherches en parallèle sur **Troc Vélo** et **Leboncoin** (cookies utilisateur, donc pas de Datadome à contourner)
4. **Synthèse** — `msrp_eur` / `retail_eur` / `estimated_market_eur` / `condition_score` / `deal_score` avec règles de décote (VTT enduro/AM/DH/dirt/junior, pénalités 26" adulte / axe 9mm / cassette 9V…) — schéma identique à `bike-ia-agent`

L'analyse s'affiche dans un **overlay flottant** injecté en bas à droite de l'annonce, en streaming, avec phases visibles.

## Backends LLM

L'extension supporte deux backends :

- **Gemini Nano** (intégré à Chrome 127+, zéro install) via l'API [LanguageModel](https://developer.chrome.com/docs/ai/built-in)
- **Ollama** local (recommandé) — qualité supérieure pour l'extraction structurée et la synthèse

En mode `auto` : Ollama si disponible (`http://localhost:11434/api/tags` répond), sinon fallback Gemini Nano.

> ⚠️ Une extension Chrome ne peut pas installer Ollama elle-même. Elle peut le **détecter** et l'utiliser. Pour installer : `winget install Ollama.Ollama` puis `ollama pull llama3.2:3b mistral:7b`.

## Installation

1. Cloner le dépôt
2. `chrome://extensions` → Mode développeur → **Charger l'extension non empaquetée** → sélectionner ce dossier
3. Ouvrir une annonce vélo sur leboncoin.fr → l'overlay apparaît automatiquement

### Activer Gemini Nano (si pas d'Ollama)

1. `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
2. `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
3. Redémarrer Chrome
4. `chrome://components` → mettre à jour **Optimization Guide On Device Model** (~2 Go)

## Architecture

```
manifest.json              # MV3 : host_permissions large, offscreen pour Nano, content scripts
background.js              # Service worker : routeur de messages, orchestre le pipeline
offscreen/                 # Document offscreen pour appeler LanguageModel (Nano)
content/
  extract.js               # Extraction de l'annonce LBC (JSON-LD + __NEXT_DATA__)
  overlay.js + overlay.css # Panneau Shadow DOM avec UI streaming
lib/
  config.js                # Constantes : retailers, manufacturers, throttle, schemas, etc.
  utils.js                 # http_get, throttle par domaine, cache disque (chrome.storage)
  llm.js                   # Adaptateur Ollama + détection backend
  identity.js              # Extraction identité (port de identity.py)
  search.js                # Web search DDG/Bing/Jina (port de search.py)
  pages.js                 # Fetch pages + extraction prix (port de pages.py)
  ranking.js               # Build queries + ranking LLM (port de ranking.py)
  comparables.js           # Comparables Troc Vélo + Leboncoin
  synth.js                 # DECOTE_RULES_BIKE + SYNTHESIS_SCHEMA (port de synth.py)
  pipeline.js              # Orchestrateur enrich_ad
options/                   # Page Options (mode LLM, cache, diagnostics)
popup/                     # Popup de diagnostic
```

## Pipeline détaillé

```
┌─────────────────────────────────────────────────────────────────────┐
│ Page LBC vélo                                                        │
│   ├── content/extract.js  →  lit __NEXT_DATA__ + JSON-LD            │
│   └── content/overlay.js  →  panneau flottant + chrome.runtime.connect│
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼ port "bike-analyze"
┌─────────────────────────────────────────────────────────────────────┐
│ background.js (service worker)                                       │
│   1. probe Ollama → backend = ollama | nano | none                  │
│   2. lib/pipeline.js::enrichAd()                                    │
│      ├─ identity (LLM)        ──▶ phase: identity_done              │
│      ├─ web search × 3 queries ──▶ phase: web_candidates             │
│      ├─ rank LLM top-6        ──▶ phase: web_ranked                 │
│      ├─ fetch pages × 6 + extract prices LLM (msrp/retail/used)     │
│      │                        ──▶ phase: web_done                   │
│      ├─ comparables Troc Vélo + LBC (parallèle)                     │
│      │                        ──▶ phase: comparables_done           │
│      └─ synth LLM + scores déterministes                            │
│                               ──▶ phase: done                       │
└─────────────────────────────────────────────────────────────────────┘
```

Pour les appels Gemini Nano (qui ne marchent pas dans le service worker MV3), un
**document offscreen** héberge l'API `LanguageModel`. Le background route les
prompts via `chrome.runtime.sendMessage`.

## Sortie

Format identique à `bike-ia-agent` (drop-in compatible avec le schéma `lbc-sniper`) :

```json
{
  "ad_url": "https://www.leboncoin.fr/...",
  "asking_price_eur": 4500,
  "brand": "Orbea", "model": "Rallon", "year": 2023,
  "frame_material": "carbon", "wheel_size": "29", "size_label": "M",
  "electric": false, "vtt_category": "enduro",
  "msrp_eur": 7499, "retail_eur": 6299, "retail_source": "Bike-Discount",
  "estimated_market_eur": 4200,
  "condition_score": 85, "deal_score": 65,
  "reasoning": "...", "pros": ["..."], "cons": ["..."],
  "_sources": { ... }
}
```

## Options

`chrome://extensions` → LBC Bike Analyzer → Détails → Options de l'extension.

- **Mode LLM** : auto / Ollama / Nano
- **URL Ollama** + modèles (extraction, synthèse)
- Activer / désactiver la recherche web, les comparables Troc Vélo / LBC
- Vider le cache HTTP (TTL 7j par défaut)
- Tester les backends

## Limites connues

- Le scraping Troc Vélo / LBC dépend du HTML public. Les sélecteurs peuvent changer ; le module `lib/comparables.js` parse en regex tolérante avec fallback sur `__NEXT_DATA__` (LBC).
- Le pipeline complet prend **30-60 s** la première fois (fetches web), puis 5-10 s avec cache.
- Gemini Nano (~3-4B) fait moins bien que `mistral:7b` sur la synthèse VTT spécialisée. Le mode Ollama est recommandé.

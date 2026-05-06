# LBC Analyzer

Extension Chrome (Manifest V3) qui analyse une annonce **Leboncoin** avec une IA locale.
Architecture **par catégorie** : chaque type d'annonce a son propre module avec ses prompts,
ses schémas et ses sources de comparaison.

## Agent IA 100% local

Contrairement aux extensions qui appellent OpenAI / Anthropic / Mistral à chaque requête,
**LBC Analyzer fait tourner l'IA sur ta machine** :

- **Aucune donnée ne quitte ton poste** — pas de transit Atlantique vers les datacenters US, pas de tracking utilisateur, pas de profil construit côté provider. Le contenu de l'annonce, ton historique de recherche, tes hésitations restent chez toi.
- **Zéro coût d'API** — pas de clé OpenAI à gérer, pas de quota qui s'épuise, pas de facture surprise après une session intensive.
- **Beaucoup moins énergivore que les LLM cloud** : un Llama 3.2 3B (Ollama / WebLLM / Gemini Nano) tourne sur ton CPU/GPU local. Comparé à un appel GPT-4 qui mobilise un cluster H100 distant pour ~10 s, l'empreinte énergétique est **divisée par 50 à 100**. Pour une analyse complète d'annonce on parle de quelques wattheures côté client vs centaines côté cloud.
- **Hors-ligne friendly** — une fois Ollama lancé ou WebLLM téléchargé, l'extension marche sans connexion (sauf pour la recherche web et le scraping LBC évidemment).
- **Pas de vendor lock-in** — tu peux changer de modèle à chaud (Llama, Mistral, Qwen, Phi…), tester ton propre fine-tune, ou désactiver l'IA et garder juste le scraping de comparables.

L'agent est **autonome** : il décide seul des requêtes web à lancer, des sources à fetcher, des comparables à retenir. Tu valides juste l'annonce ouverte — il fait le reste en 30-60 s.



## Catégories

| Catégorie | Pipeline | Statut |
|---|---|---|
| **Vélo** | identité (marque/modèle/version/taille de roues/cadre/VAE) → catalogue web (constructeurs + Alltricks/Bike-Discount/Probikeshop) → comparables Troc Vélo + Leboncoin → synthèse `msrp_eur` / `retail_eur` / `estimated_market_eur` / `deal_score` (port fidèle de [bike-ia-agent](https://github.com/ThibaultBrun/bike-ia-agent)) | ✅ V1 |
| **Voiture, multimédia, immo, …** | À venir | 🚧 |
| **Default** (fallback) | Résumé + points d'attention + questions à poser au vendeur | ✅ V1 |

L'analyse s'affiche dans un **overlay flottant** Shadow DOM en bas à droite de l'annonce, avec :
- les phases du pipeline en streaming (Identité → Catalogue → Comparables → Synthèse)
- la catégorie détectée (badge dans l'en-tête)
- le backend utilisé (badge Ollama / WebLLM / Gemini Nano)

## Backends LLM

Trois backends, sélectionnés en cascade en mode `auto` :

1. **Ollama** local (recommandé, qualité maximale) — détecté via `http://localhost:11434/api/tags`
2. **WebLLM** (zéro install, WebGPU) — Llama 3.1 8B / Mistral 7B / Qwen 2.5 / Phi 3.5 dans le navigateur via [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm). 1ʳᵉ utilisation = téléchargement modèle (2-5 Go), stocké localement par Chrome.
3. **Gemini Nano** intégré à Chrome 127+ — fallback minimal, qualité limitée (~3-4B).

> Une extension Chrome ne peut pas installer Ollama. Pour la qualité max : `winget install Ollama.Ollama` puis `ollama pull llama3.2:3b mistral:7b`. Sans Ollama, **WebLLM est le défaut zéro-install recommandé**.

## Installation

```powershell
git clone https://github.com/ThibaultBrun/lbc-agent-chrome-ext.git
cd lbc-agent-chrome-ext
```

Puis dans Chrome : `chrome://extensions` → Mode développeur → **Charger l'extension non empaquetée** → sélectionner ce dossier.

Le bundle WebLLM est commité dans `dist/` : **aucun build n'est requis** pour utiliser l'extension.

### Build local (uniquement pour développer)

```powershell
npm install
npm run build      # bundle dist/webllm.bundle.js (~6 Mo)
npm run watch      # rebuild auto en dev
```

### Activer Gemini Nano (si ni Ollama ni WebLLM)

1. `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
2. `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
3. Redémarrer Chrome
4. `chrome://components` → mettre à jour **Optimization Guide On Device Model** (~2 Go)

## Architecture

```
manifest.json              # MV3
background.js              # Service worker : router de messages, lance le pipeline
offscreen/                 # Document offscreen : héberge WebLLM (WebGPU) + Gemini Nano
content/
  extract.js               # Content script : extraction LBC (JSON-LD + __NEXT_DATA__)
  overlay.js               # Content script : panneau Shadow DOM (streaming + UI)
dist/
  webllm.bundle.js         # @mlc-ai/web-llm bundlé (~6 Mo)

lib/
  core/                    # 100% générique — jamais touché par catégorie
    config.js              # USER_AGENTS, throttle, cache, settings, regex prix
    utils.js               # httpGet, throttle, cache, normalizeSpace, median
    llm.js                 # Probe + adapter Ollama / WebLLM / Nano + selectBackend
    llm-router.js          # Classe LlmRouter (json/text uniformes)
    search.js              # Web search DDG → Bing → Jina (excludedDomains paramétrable)
    pages.js               # Fetch page (Jina Reader + fallback) + regex prix générique
    extract-base.js        # Champs neutres LBC (titre/body/prix/lieu/attrs)
    synth-base.js          # ratioToScore, combineDealScores, summarizePrices
    pipeline.js            # Orchestrateur générique : delegate à categories[].enrichAd()

  categories/
    index.js               # Registry + resolveCategory(ad)

    velo/
      catalog.js           # MANUFACTURER_DOMAINS, KNOWN_RETAILERS, ELECTRIC_KEYWORDS, etc.
      detect.js            # detect(ad) → boolean (URL /ad/velos/, mots-clés titre…)
      identity.js          # IDENTITY_SCHEMA + buildIdentityPrompt + postProcessIdentity
      ranking.js           # buildSearchQueries + buildRankPrompt + RANK_SCHEMA
      pages.js             # buildPriceExtractionPrompt (hint constructeur/revendeur/junior)
      comparables.js       # fetchAllComparables = Troc Vélo + LBC en parallèle
      synth.js             # DECOTE_RULES_BIKE + SYNTHESIS_SCHEMA + buildSynthesisPrompt + decoteFactor
      extract.js           # Extension de extract-base avec is_velo
      ui.js                # Renderers spécialisés (3 prix, badges, comparables)
      index.js             # Module catégorie : { id, label, detect, enrichAd, uiRendererPath }

    default/
      index.js             # Fallback : summary + pros/cons + questions à poser

options/                   # Page Options
popup/                     # Popup de diagnostic
```

## Ajouter une catégorie

1. Créer `lib/categories/<id>/`
2. Implémenter au minimum `index.js` avec :
   ```js
   export default {
     id: "voiture",
     label: "Voiture",
     detect: (ad) => /\/ad\/voitures\//.test(ad.url),
     enrichAd: async ({ ad, llm, settings, emit, log, phase }) => { ... },
   };
   ```
3. L'ajouter dans `lib/categories/index.js` (avant `default`)
4. Ajouter la détection dans `content/extract.js::detectCategory`

Le pipeline générique appelle `category.enrichAd(...)`. Toute la logique métier
(prompts, schémas, sources, règles de décote) vit dans le dossier de catégorie.

## Pipeline (catégorie vélo)

```
Page LBC                               Service worker (background.js)
  └ extract.js                                ┌── pipeline.js
  └ overlay.js ── port "bike-analyze" ───▶  resolveCategory(ad) → velo
                                              ├── identity (LLM + post-process)
                                              ├── web search (DDG/Bing/Jina)
                                              ├── ranking LLM top-6
                                              ├── fetch pages × 6 + price extraction LLM
                                              ├── comparables Troc Vélo + LBC en parallèle
                                              └── synth LLM + scores déterministes (vs new + vs used)
```

Les appels Gemini Nano et WebLLM ne marchent pas dans un service worker MV3 ;
un **document offscreen** les héberge. Le background route via `chrome.runtime.sendMessage`.

## Sortie (catégorie vélo)

Format identique à `bike-ia-agent` :

```json
{
  "category": "velo",
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

`chrome://extensions` → LBC Analyzer → Détails → Options de l'extension.

- **Mode LLM** : auto / Ollama / WebLLM / Nano
- **URL Ollama** + modèles (extraction `llama3.2:3b`, synthèse `mistral:7b` recommandés)
- Sélection du modèle WebLLM
- Activer / désactiver la recherche web, les comparables Troc Vélo / LBC
- Vider le cache HTTP (TTL 7j par défaut)
- Tester les 3 backends

## Limites connues

- Le scraping Troc Vélo / LBC dépend du HTML public — les sélecteurs peuvent changer.
- Le pipeline complet (catégorie vélo) prend **30-60 s** la première fois, puis 5-10 s avec cache.
- Gemini Nano (~3-4B) fait moins bien que `mistral:7b` sur la synthèse spécialisée. **Mode Ollama recommandé** pour la qualité.
- L'extension a été conçue à partir du workflow Python `bike-ia-agent` ; le portage est fidèle mais non testé exhaustivement en navigateur.

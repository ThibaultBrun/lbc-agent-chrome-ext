# LBC Analyzer — Extension Chrome

Extension Chrome (Manifest V3) qui analyse une annonce Leboncoin à l'aide du
modèle IA **embarqué dans Chrome** (Gemini Nano via l'API `LanguageModel`).

Tout reste local : aucune donnée n'est envoyée vers un service externe.

## Fonctionnalités

- Extraction automatique de l'annonce ouverte (titre, prix, lieu, description, critères) via JSON-LD + sélecteurs DOM
- Analyse synthétique : résumé, points positifs, points de vigilance, questions à poser, cohérence du prix
- Streaming du texte généré directement dans le popup

## Prérequis

L'API Prompt embarquée Chrome n'est pas activée par défaut. Sur Chrome 127+ :

1. Aller sur `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**
2. Aller sur `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
3. Redémarrer Chrome
4. Ouvrir `chrome://components` et déclencher la mise à jour de **Optimization Guide On Device Model** pour télécharger Gemini Nano (~2 Go)
5. Vérifier dans la console : `await LanguageModel.availability()` doit renvoyer `available`

## Installation (mode développeur)

1. `chrome://extensions` → activer le **Mode développeur**
2. Cliquer sur **Charger l'extension non empaquetée**
3. Sélectionner ce dossier
4. Ouvrir une annonce sur leboncoin.fr puis cliquer sur l'icône de l'extension

## Structure

```
manifest.json       # Manifest V3
background.js       # Service worker minimal
content/extract.js  # Extraction de l'annonce depuis le DOM
popup/              # UI du popup + appel à LanguageModel
```

## Développement

Pas de build : JS/HTML/CSS vanilla. Recharger l'extension après modification.

## Notes

- Les sélecteurs DOM Leboncoin peuvent évoluer ; le fallback principal est le JSON-LD `Product`.
- Le prompt est tronqué à 4000 caractères pour rester dans les limites du modèle local.

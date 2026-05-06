// Point d'entrée bundler : ré-exporte ce qu'on utilise depuis @mlc-ai/web-llm
// pour que l'offscreen ait un fichier ES module local à importer.

export {
  CreateMLCEngine,
  prebuiltAppConfig,
  hasModelInCache,
  deleteModelAllInfoInCache,
} from "@mlc-ai/web-llm";

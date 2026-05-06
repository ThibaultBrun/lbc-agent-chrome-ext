// Stub vide pour les modules Node (url, fs, path, perf_hooks) que WebLLM
// référence dans des branches Node-only jamais exécutées en navigateur.
export default {};
export const pathToFileURL = () => null;
export const fileURLToPath = () => null;
export const performance = (typeof self !== "undefined" && self.performance) || null;

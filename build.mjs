// Build minimal : on bundle uniquement le module WebLLM dans dist/webllm.bundle.js.
// Le reste de l'extension (lib/, content/, background.js) reste en ESM natif.

import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/webllm-entry.js"],
  bundle: true,
  outfile: "dist/webllm.bundle.js",
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  minify: false,
  sourcemap: true,
  logLevel: "info",
  // WebLLM contient un require Node-only pour 'url' jamais exécuté en navigateur ;
  // on le stub pour éviter l'erreur de résolution.
  external: [],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  alias: {
    url: "./src/stubs/empty.js",
    fs: "./src/stubs/empty.js",
    path: "./src/stubs/empty.js",
    perf_hooks: "./src/stubs/empty.js",
  },
});

if (watch) {
  await ctx.watch();
  console.log("[build] watching…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("[build] done → dist/webllm.bundle.js");
}

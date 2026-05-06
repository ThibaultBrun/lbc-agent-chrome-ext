// Renderer overlay spécialisé vélo : injecte les sections spécifiques
// dans la zone "category-body" du panneau Shadow DOM.
//
// L'overlay générique fournit la structure (header, phases, scores, pros/cons,
// reasoning, log). Ce module ajoute :
//   - le bloc identité (marque/modèle/version/année + taille roues + cadre + VAE)
//   - le tableau 3 prix (MSRP / Retail / Marché occasion)
//   - la liste comparables avec tag LBC / TROC

export const STYLE_EXTRA = `
  .velo-identity { font-size: 13px; }
  .velo-identity .brand-model { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 2px; }
  .velo-identity .meta { color: #9aa0ac; font-size: 12px; }
  .velo-prices-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .velo-price-cell { background: #1a1d23; border-radius: 8px; padding: 8px 10px; text-align: center; }
  .velo-price-cell .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6f7682; }
  .velo-price-cell .value { font-size: 15px; font-weight: 600; color: #e6e8ee; margin-top: 2px; }
  .velo-price-cell .source { font-size: 10px; color: #6f7682; margin-top: 2px; }
  .velo-comparable-list { font-size: 11px; max-height: 160px; overflow-y: auto; }
  .velo-comparable-list .row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px dashed #2a2e36; }
  .velo-comparable-list .row a { color: #cfdcff; text-decoration: none; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .velo-comparable-list .row a:hover { text-decoration: underline; }
  .velo-comparable-list .row .price { color: #4dd987; font-weight: 600; white-space: nowrap; }
  .velo-comparable-list .src-tag { font-size: 9px; padding: 0 4px; border-radius: 3px; margin-right: 4px; }
  .velo-comparable-list .src-tag.lbc { background: #ff6e14; color: #fff; }
  .velo-comparable-list .src-tag.trocvelo { background: #2a86d8; color: #fff; }
`;

function fmtPrice(n) {
  if (n == null || isNaN(n)) return "—";
  return Math.round(n).toLocaleString("fr-FR") + " €";
}

function el(doc, tag, attrs = {}, children = []) {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.appendChild(typeof c === "string" ? doc.createTextNode(c) : c);
  }
  return e;
}

// Appelé sur l'événement `phase: identity_done` — affiche la carte identité
export function renderIdentity(shadow, identity) {
  const card = shadow.getElementById("identity-card");
  const body = shadow.getElementById("identity-body");
  body.innerHTML = "";
  body.classList.add("velo-identity");
  const brandModel = [identity.marque, identity.version, identity.modele, identity.annee].filter(Boolean).join(" ");
  body.appendChild(el(shadow.ownerDocument || document, "div", { class: "brand-model" }, brandModel || "(non identifié)"));
  const meta = [];
  if (identity.taille_roues) meta.push(`${identity.taille_roues}"`);
  if (identity.taille_cadre) meta.push(`Taille ${identity.taille_cadre}`);
  if (identity.electric === true) meta.push("VAE/électrique");
  else if (identity.electric === false) meta.push("musculaire");
  body.appendChild(el(shadow.ownerDocument || document, "div", { class: "meta" }, meta.join(" · ")));
  card.classList.remove("hidden");
}

// Appelé sur `phase: done` (résultat final) — affiche le tableau de prix
export function renderPrices(shadow, ad, synth) {
  const askingRow = shadow.getElementById("asking-row");
  askingRow.innerHTML = "";
  askingRow.appendChild(el(document, "div", { class: "label" }, "Prix demandé"));
  askingRow.appendChild(el(document, "div", { class: "value" }, fmtPrice(ad.price)));

  const grid = shadow.getElementById("prices-grid");
  grid.innerHTML = "";
  grid.classList.add("velo-prices-grid");
  const cells = [
    { label: "MSRP catalogue", value: synth.msrp_eur, source: "constructeur" },
    { label: "Neuf revendeur", value: synth.retail_eur, source: synth.retail_source || "—" },
    { label: "Marché occasion", value: synth.estimated_market_eur, source: synth._sources?.comparables_count ? `${synth._sources.comparables_count} comp.` : "estimé" },
  ];
  for (const c of cells) {
    grid.appendChild(el(document, "div", { class: "velo-price-cell" }, [
      el(document, "div", { class: "label" }, c.label),
      el(document, "div", { class: "value" }, fmtPrice(c.value)),
      el(document, "div", { class: "source" }, c.source),
    ]));
  }
  shadow.getElementById("prices-card").classList.remove("hidden");
}

// Appelé sur `phase: comparables_done`
export function renderComparables(shadow, comparables) {
  const card = shadow.getElementById("comparables-card");
  const list = shadow.getElementById("comparables-list");
  const summary = shadow.getElementById("comparables-summary");
  list.innerHTML = "";
  list.classList.add("velo-comparable-list");
  if (!comparables.length) { card.classList.add("hidden"); return; }
  summary.textContent = `Comparables (${comparables.length})`;
  for (const c of comparables.slice(0, 20)) {
    list.appendChild(el(document, "div", { class: "row" }, [
      el(document, "span", { class: `src-tag ${c.source}` }, (c.source || "?").toUpperCase()),
      el(document, "a", { href: c.url, target: "_blank", rel: "noopener" }, (c.subject || "—").slice(0, 80)),
      el(document, "span", { class: "price" }, fmtPrice(c.price_eur)),
    ]));
  }
  card.classList.remove("hidden");
}

export default {
  styleExtra: STYLE_EXTRA,
  renderIdentity,
  renderPrices,
  renderComparables,
};

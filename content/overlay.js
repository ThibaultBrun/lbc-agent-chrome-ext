// Content script (2/2) : panneau flottant Shadow DOM avec UI sympa.
// Injecté sur les annonces vélo Leboncoin. Démarre le pipeline via port runtime
// vers le background, qui pousse les phases (identity → web → comparables → synth → done).

(function () {
  if (window.__lbcBikeOverlayLoaded) return;
  window.__lbcBikeOverlayLoaded = true;

  const SHADOW_HOST_ID = "lbc-bike-analyzer-host";

  const STYLE = `
    :host { all: initial; }
    .panel {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      width: 380px; max-height: 80vh;
      background: #16181d; color: #e6e8ee;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px; line-height: 1.45;
      border-radius: 14px;
      box-shadow: 0 24px 60px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.25);
      overflow: hidden;
      display: flex; flex-direction: column;
      border: 1px solid #2a2e36;
    }
    .panel.collapsed { height: 44px; min-height: 44px; max-height: 44px; }
    header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; background: linear-gradient(135deg, #ff6e14 0%, #ff8a3d 100%);
      color: #fff; cursor: move; user-select: none;
    }
    header .logo {
      width: 22px; height: 22px; border-radius: 50%;
      background: #fff; color: #ff6e14; display: grid; place-items: center;
      font-weight: 700; font-size: 13px;
    }
    header h1 { flex: 1; font-size: 13px; margin: 0; font-weight: 600; letter-spacing: 0.2px; }
    header button {
      border: 0; background: rgba(255,255,255,0.18); color: #fff;
      width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
      display: grid; place-items: center;
    }
    header button:hover { background: rgba(255,255,255,0.28); }
    main { padding: 12px 14px; overflow-y: auto; }
    .ad-line { font-size: 12px; color: #9aa0ac; margin: 0 0 8px; }
    .ad-line strong { color: #e6e8ee; }
    .phases { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
    .phase {
      flex: 1; min-width: 60px;
      padding: 6px 4px; border-radius: 6px; background: #1f2229; border: 1px solid #2a2e36;
      font-size: 10px; text-align: center; color: #6f7682;
      transition: all 0.2s ease;
    }
    .phase.active { background: #2a3344; border-color: #4a86ff; color: #cfdcff; box-shadow: 0 0 0 2px rgba(74,134,255,0.15); }
    .phase.done { background: #1d2a1f; border-color: #2f6b3a; color: #aaeab8; }
    .phase.error { background: #2d1a1a; border-color: #6b2f2f; color: #ffaaa5; }
    .card {
      background: #1f2229; border: 1px solid #2a2e36; border-radius: 10px;
      padding: 10px 12px; margin-bottom: 10px;
    }
    .card h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #8a91a0; font-weight: 600; }
    .identity { font-size: 13px; }
    .identity .brand-model { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 2px; }
    .identity .meta { color: #9aa0ac; font-size: 12px; }
    .prices-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .price-cell { background: #1a1d23; border-radius: 8px; padding: 8px 10px; text-align: center; }
    .price-cell .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6f7682; }
    .price-cell .value { font-size: 15px; font-weight: 600; color: #e6e8ee; margin-top: 2px; }
    .price-cell .source { font-size: 10px; color: #6f7682; margin-top: 2px; }
    .asking-row { display: flex; align-items: baseline; gap: 8px; margin: 8px 0 12px; padding: 10px 12px; background: linear-gradient(135deg, rgba(255,110,20,0.08), rgba(255,110,20,0.02)); border: 1px solid rgba(255,110,20,0.25); border-radius: 8px; }
    .asking-row .label { font-size: 11px; color: #9aa0ac; }
    .asking-row .value { font-size: 18px; font-weight: 700; color: #ff8a3d; }
    .scores { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .score-box { padding: 10px; background: #1a1d23; border-radius: 8px; text-align: center; }
    .score-box .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6f7682; }
    .score-box .value { font-size: 22px; font-weight: 700; margin-top: 4px; }
    .gauge { height: 4px; background: #2a2e36; border-radius: 2px; margin-top: 6px; overflow: hidden; }
    .gauge .fill { height: 100%; transition: width 0.4s ease; }
    .deal-bad .value { color: #ff6b6b; } .deal-bad .gauge .fill { background: #ff6b6b; }
    .deal-mid .value { color: #ffb84d; } .deal-mid .gauge .fill { background: #ffb84d; }
    .deal-good .value { color: #4dd987; } .deal-good .gauge .fill { background: #4dd987; }
    .pros-cons { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .pros, .cons { display: flex; flex-direction: column; gap: 4px; }
    .pros li { color: #4dd987; }
    .cons li { color: #ffb84d; }
    .pros-cons ul { margin: 0; padding-left: 16px; font-size: 12px; }
    .reasoning { font-size: 12px; color: #b8bdc8; margin: 0; }
    .actions { display: flex; gap: 8px; margin-top: 10px; }
    .actions button {
      flex: 1; padding: 8px; font-size: 12px; border-radius: 6px;
      background: #2a2e36; color: #e6e8ee; border: 1px solid #353a44; cursor: pointer;
      transition: background 0.15s;
    }
    .actions button:hover { background: #353a44; }
    .actions button.primary { background: #ff6e14; border-color: #ff6e14; color: #fff; }
    .actions button.primary:hover { background: #ff8a3d; }
    .log { font-size: 10px; color: #6f7682; max-height: 80px; overflow-y: auto; font-family: monospace; }
    .log div { padding: 2px 0; border-bottom: 1px dashed #2a2e36; }
    .hidden { display: none !important; }
    .spinner {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid #2a2e36; border-top-color: #ff8a3d;
      animation: spin 0.8s linear infinite; display: inline-block; vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .backend-badge {
      display: inline-block; padding: 1px 6px; font-size: 10px; border-radius: 3px;
      background: #2a3344; color: #cfdcff; margin-left: 6px;
    }
    details { margin-top: 8px; }
    details summary { cursor: pointer; font-size: 11px; color: #8a91a0; }
    .comparable-list { font-size: 11px; max-height: 160px; overflow-y: auto; }
    .comparable-list .row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px dashed #2a2e36; }
    .comparable-list .row a { color: #cfdcff; text-decoration: none; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .comparable-list .row a:hover { text-decoration: underline; }
    .comparable-list .row .price { color: #4dd987; font-weight: 600; white-space: nowrap; }
    .comparable-list .src-tag { font-size: 9px; padding: 0 4px; border-radius: 3px; margin-right: 4px; }
    .comparable-list .src-tag.lbc { background: #ff6e14; color: #fff; }
    .comparable-list .src-tag.trocvelo { background: #2a86d8; color: #fff; }
  `;

  const PHASES_DEF = [
    { id: "identity", label: "Identité" },
    { id: "web", label: "Catalogue" },
    { id: "comparables", label: "Comparables" },
    { id: "synth", label: "Synthèse" },
  ];

  function fmtPrice(n) {
    if (n == null || isNaN(n)) return "—";
    return Math.round(n).toLocaleString("fr-FR") + " €";
  }
  function dealClass(s) {
    if (s == null) return "deal-mid";
    if (s >= 70) return "deal-good";
    if (s >= 40) return "deal-mid";
    return "deal-bad";
  }
  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return e;
  }

  function buildPanel(shadow, ad) {
    const style = el("style"); style.textContent = STYLE;
    shadow.appendChild(style);

    const panel = el("div", { class: "panel" });
    const header = el("header", {}, [
      el("div", { class: "logo" }, "B"),
      el("h1", {}, ["LBC Bike Analyzer", el("span", { class: "backend-badge", id: "backend-badge" }, "…")]),
      el("button", { id: "btn-toggle", title: "Réduire" }, "—"),
      el("button", { id: "btn-close", title: "Fermer" }, "✕"),
    ]);
    const main = el("main");

    const adLine = el("p", { class: "ad-line" }, [
      el("strong", {}, ad.subject || "(annonce)"),
      ad.price ? ` · ${fmtPrice(ad.price)}` : "",
      ad.city ? ` · ${ad.city}` : "",
    ]);

    const phasesEl = el("div", { class: "phases" },
      PHASES_DEF.map((p) => el("div", { class: "phase", id: `phase-${p.id}` }, p.label)),
    );

    const identityCard = el("div", { class: "card hidden", id: "identity-card" }, [
      el("h3", {}, "Identité"),
      el("div", { class: "identity", id: "identity-body" }),
    ]);

    const pricesCard = el("div", { class: "card hidden", id: "prices-card" }, [
      el("h3", {}, "Prix"),
      el("div", { class: "asking-row", id: "asking-row" }),
      el("div", { class: "prices-grid", id: "prices-grid" }),
    ]);

    const scoresCard = el("div", { class: "card hidden", id: "scores-card" }, [
      el("h3", {}, "Évaluation"),
      el("div", { class: "scores", id: "scores-body" }),
    ]);

    const synthCard = el("div", { class: "card hidden", id: "synth-card" }, [
      el("h3", {}, "Synthèse"),
      el("div", { id: "synth-body" }, [
        el("div", { class: "pros-cons" }, [
          el("div", { class: "pros" }, [el("strong", { html: "Points forts" }), el("ul", { id: "pros-list" })]),
          el("div", { class: "cons" }, [el("strong", { html: "À surveiller" }), el("ul", { id: "cons-list" })]),
        ]),
        el("p", { class: "reasoning", id: "reasoning", style: "margin-top:8px;" }),
      ]),
    ]);

    const compaCard = el("details", { id: "comparables-card", class: "card hidden" }, [
      el("summary", {}, [el("span", { id: "comparables-summary" }, "Comparables")]),
      el("div", { class: "comparable-list", id: "comparables-list" }),
    ]);

    const actions = el("div", { class: "actions" }, [
      el("button", { id: "btn-rerun", class: "primary" }, "Re-analyser"),
      el("button", { id: "btn-options" }, "Options"),
    ]);

    const logCard = el("details", {}, [
      el("summary", {}, "Logs"),
      el("div", { class: "log", id: "log" }),
    ]);

    main.appendChild(adLine);
    main.appendChild(phasesEl);
    main.appendChild(identityCard);
    main.appendChild(pricesCard);
    main.appendChild(scoresCard);
    main.appendChild(synthCard);
    main.appendChild(compaCard);
    main.appendChild(actions);
    main.appendChild(logCard);

    panel.appendChild(header);
    panel.appendChild(main);
    shadow.appendChild(panel);

    // Drag
    let dragging = false, ox = 0, oy = 0;
    header.addEventListener("mousedown", (e) => {
      if (["BUTTON"].includes(e.target.tagName)) return;
      dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop;
      panel.style.right = "auto"; panel.style.bottom = "auto";
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = (e.clientX - ox) + "px";
      panel.style.top = (e.clientY - oy) + "px";
    });
    document.addEventListener("mouseup", () => { dragging = false; });

    return panel;
  }

  function setPhase(shadow, id, status) {
    const e = shadow.getElementById(`phase-${id}`);
    if (!e) return;
    e.classList.remove("active", "done", "error");
    if (status) e.classList.add(status);
  }

  function appendLog(shadow, msg) {
    const log = shadow.getElementById("log");
    if (!log) return;
    const line = document.createElement("div");
    line.textContent = msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function renderIdentity(shadow, identity) {
    const card = shadow.getElementById("identity-card");
    const body = shadow.getElementById("identity-body");
    body.innerHTML = "";
    const brandModel = [identity.marque, identity.version, identity.modele, identity.annee].filter(Boolean).join(" ");
    body.appendChild(el("div", { class: "brand-model" }, brandModel || "(non identifié)"));
    const meta = [];
    if (identity.taille_roues) meta.push(`${identity.taille_roues}"`);
    if (identity.taille_cadre) meta.push(`Taille ${identity.taille_cadre}`);
    if (identity.electric === true) meta.push("VAE/électrique");
    else if (identity.electric === false) meta.push("musculaire");
    body.appendChild(el("div", { class: "meta" }, meta.join(" · ")));
    card.classList.remove("hidden");
  }

  function renderPrices(shadow, ad, synth) {
    const askingRow = shadow.getElementById("asking-row");
    askingRow.innerHTML = "";
    askingRow.appendChild(el("div", { class: "label" }, "Prix demandé"));
    askingRow.appendChild(el("div", { class: "value" }, fmtPrice(ad.price)));

    const grid = shadow.getElementById("prices-grid");
    grid.innerHTML = "";
    const cells = [
      { label: "MSRP catalogue", value: synth.msrp_eur, source: "constructeur" },
      { label: "Neuf revendeur", value: synth.retail_eur, source: synth.retail_source || "—" },
      { label: "Marché occasion", value: synth.estimated_market_eur, source: synth._sources?.comparables_count ? `${synth._sources.comparables_count} comp.` : "estimé" },
    ];
    for (const c of cells) {
      grid.appendChild(el("div", { class: "price-cell" }, [
        el("div", { class: "label" }, c.label),
        el("div", { class: "value" }, fmtPrice(c.value)),
        el("div", { class: "source" }, c.source),
      ]));
    }
    shadow.getElementById("prices-card").classList.remove("hidden");
  }

  function renderScores(shadow, synth) {
    const body = shadow.getElementById("scores-body");
    body.innerHTML = "";
    const deal = synth.deal_score;
    const cond = synth.condition_score;

    body.appendChild(el("div", { class: `score-box ${dealClass(deal)}` }, [
      el("div", { class: "label" }, "Bonne affaire"),
      el("div", { class: "value" }, deal != null ? `${deal}/100` : "—"),
      el("div", { class: "gauge" }, [el("div", { class: "fill", style: `width: ${deal || 0}%` })]),
    ]));
    body.appendChild(el("div", { class: `score-box ${dealClass(cond)}` }, [
      el("div", { class: "label" }, "État estimé"),
      el("div", { class: "value" }, cond != null ? `${cond}/100` : "—"),
      el("div", { class: "gauge" }, [el("div", { class: "fill", style: `width: ${cond || 0}%` })]),
    ]));
    shadow.getElementById("scores-card").classList.remove("hidden");
  }

  function renderSynth(shadow, synth) {
    const prosList = shadow.getElementById("pros-list");
    const consList = shadow.getElementById("cons-list");
    prosList.innerHTML = ""; consList.innerHTML = "";
    for (const p of (synth.pros || [])) prosList.appendChild(el("li", {}, p));
    for (const c of (synth.cons || [])) consList.appendChild(el("li", {}, c));
    shadow.getElementById("reasoning").textContent = synth.reasoning || "";
    shadow.getElementById("synth-card").classList.remove("hidden");
  }

  function renderComparables(shadow, comparables) {
    const card = shadow.getElementById("comparables-card");
    const list = shadow.getElementById("comparables-list");
    const summary = shadow.getElementById("comparables-summary");
    list.innerHTML = "";
    if (!comparables.length) { card.classList.add("hidden"); return; }
    summary.textContent = `Comparables (${comparables.length})`;
    for (const c of comparables.slice(0, 20)) {
      list.appendChild(el("div", { class: "row" }, [
        el("span", { class: `src-tag ${c.source}` }, (c.source || "?").toUpperCase()),
        el("a", { href: c.url, target: "_blank", rel: "noopener" }, (c.subject || "—").slice(0, 80)),
        el("span", { class: "price" }, fmtPrice(c.price_eur)),
      ]));
    }
    card.classList.remove("hidden");
  }

  // ─── Lancement du pipeline ───────────────────────────────────────────

  let port = null;
  function startAnalysis(shadow, ad) {
    if (port) try { port.disconnect(); } catch {}
    port = chrome.runtime.connect({ name: "bike-analyze" });
    port.postMessage({ type: "analyze", ad });
    setPhase(shadow, "identity", "active");

    port.onMessage.addListener((msg) => {
      if (msg.type === "log") appendLog(shadow, msg.message);
      else if (msg.type === "backend") {
        const b = shadow.getElementById("backend-badge");
        b.textContent = msg.backend.kind === "ollama" ? "Ollama" : (msg.backend.kind === "nano" ? "Gemini Nano" : "—");
      }
      else if (msg.type === "phase") {
        switch (msg.phase) {
          case "identity_done":
            setPhase(shadow, "identity", "done");
            setPhase(shadow, "web", "active");
            renderIdentity(shadow, msg.identity);
            break;
          case "web_done":
            setPhase(shadow, "web", "done");
            setPhase(shadow, "comparables", "active");
            break;
          case "comparables_done":
            setPhase(shadow, "comparables", "done");
            setPhase(shadow, "synth", "active");
            renderComparables(shadow, msg.comparables || []);
            break;
          case "done":
            setPhase(shadow, "synth", "done");
            const r = msg.result;
            renderPrices(shadow, ad, r);
            renderScores(shadow, r);
            renderSynth(shadow, r);
            break;
        }
      }
      else if (msg.type === "error") {
        appendLog(shadow, `[error] ${msg.error}`);
        for (const p of PHASES_DEF) {
          const e = shadow.getElementById(`phase-${p.id}`);
          if (e && e.classList.contains("active")) e.classList.remove("active"), e.classList.add("error");
        }
      }
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────

  function init() {
    if (!window.__lbcBikeExtract) return;
    const ad = window.__lbcBikeExtract();
    if (!ad) return;

    // Détection vélo : si pas un vélo, on n'injecte rien.
    if (!ad.is_velo) return;

    const host = document.createElement("div");
    host.id = SHADOW_HOST_ID;
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const panel = buildPanel(shadow, ad);

    shadow.getElementById("btn-close").addEventListener("click", () => { host.remove(); });
    shadow.getElementById("btn-toggle").addEventListener("click", () => { panel.classList.toggle("collapsed"); });
    shadow.getElementById("btn-rerun").addEventListener("click", () => startAnalysis(shadow, ad));
    shadow.getElementById("btn-options").addEventListener("click", () => chrome.runtime.sendMessage({ type: "open_options" }) || chrome.runtime.openOptionsPage?.());

    startAnalysis(shadow, ad);
  }

  // L'extraction peut nécessiter que __NEXT_DATA__ soit présent → petite attente.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 800));
  } else {
    setTimeout(init, 800);
  }
})();

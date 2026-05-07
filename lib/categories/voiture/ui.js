// Renderer overlay specifique voiture. La carte 'Fiabilite' est un ajout
// majeur par rapport au velo : elle liste les pannes connues + must_check.

export const STYLE_EXTRA = `
  .auto-prices-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  .auto-price-cell { background: #1a1d23; border-radius: 8px; padding: 8px 10px; text-align: center; }
  .reliability-score { font-size: 22px; font-weight: 700; }
  .reliability-bad { color: #ff6b6b; }
  .reliability-mid { color: #ffb84d; }
  .reliability-good { color: #4dd987; }
  .issues-list { margin: 0; padding-left: 16px; font-size: 12px; }
  .issues-list li { padding: 3px 0; }
  .issue-severity-critique { color: #ff6b6b; font-weight: 700; }
  .issue-severity-grave { color: #ff8a3d; font-weight: 600; }
  .issue-severity-moyen { color: #ffb84d; }
  .issue-severity-mineur { color: #b8bdc8; }
  .must-check { color: #ffb84d; font-size: 12px; }
`;

export default {
  styleExtra: STYLE_EXTRA,
};

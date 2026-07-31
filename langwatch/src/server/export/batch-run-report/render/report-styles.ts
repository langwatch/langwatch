import type { Tone } from "../report.types";

/**
 * The token a {@link Tone} contributes to a class name.
 *
 * Lives beside the stylesheet that defines `.tone-*` and `.fill-*` so the two
 * cannot drift: adding a tone is a compile error here until it has a colour.
 */
export function toneToken(tone: Tone | undefined): string {
  switch (tone ?? "neutral") {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "warn":
      return "warn";
    case "muted":
      return "muted";
    case "neutral":
      return "neutral";
  }
}

/**
 * The report's only stylesheet, inlined into the document.
 *
 * System font stacks and hand-written rules rather than a framework: the file
 * has to render completely from `file://` on a machine with no network, so
 * every byte it needs is in the document or it does not exist.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
export const REPORT_STYLES = `
:root {
  --ink: #1a202c;
  --ink-soft: #4a5568;
  --ink-faint: #718096;
  --rule: #e2e8f0;
  --surface: #ffffff;
  --surface-soft: #f7fafc;
  --pass: #38a169;
  --fail: #e53e3e;
  --warn: #d69e2e;
  --muted: #a0aec0;
  --neutral: #4299e1;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1.25rem 4rem;
  background: var(--surface-soft);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.55;
}
main { max-width: 60rem; margin: 0 auto; }
h1 { font-size: 1.75rem; margin: 0 0 0.25rem; }
h2 { font-size: 1.25rem; margin: 2rem 0 0.5rem; }
h3 { font-size: 1.05rem; margin: 1.5rem 0 0.35rem; }
h4 { font-size: 0.95rem; margin: 0 0 0.25rem; }
p { margin: 0 0 0.6rem; }
.card {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin: 0 0 1rem;
}
.meta { color: var(--ink-faint); font-size: 0.85rem; margin: 0 0 0.75rem; }
.summary { border-left: 4px solid var(--neutral); }
.verdict { font-size: 1.35rem; font-weight: 600; line-height: 1.3; margin: 0 0 0.25rem; }
.verdict.tone-pass { color: var(--pass); }
.verdict.tone-fail { color: var(--fail); }
.verdict.tone-warn { color: var(--warn); }
.movement { color: var(--ink-soft); margin: 0 0 0.5rem; }
.summary-line { margin: 0.5rem 0 0; }
.summary-label {
  display: block;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-faint);
}
.summary-line.caveat { color: var(--ink-soft); }
.meta span { margin-right: 1rem; }
.badge {
  display: inline-block;
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 0.1rem 0.7rem;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.badge-verified { border-color: var(--pass); color: var(--pass); }
.badge-unchecked { border-color: var(--warn); color: var(--warn); }
.badge-figures_only { border-color: var(--muted); color: var(--ink-soft); }
.tier-note { color: var(--ink-soft); font-size: 0.9rem; margin: 0.5rem 0 0; }
.headline-rate { font-size: 1.1rem; font-weight: 600; }
.question { color: var(--ink-faint); font-size: 0.85rem; margin: 0 0 0.75rem; }
.gap { color: var(--ink-soft); font-style: italic; }
.stats { display: flex; flex-wrap: wrap; gap: 1.25rem; margin: 0.5rem 0; }
.stats div { min-width: 6rem; }
.stats dt { color: var(--ink-faint); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
.stats dd { margin: 0; font-size: 1.2rem; font-weight: 600; }
.stats .hint { display: block; font-size: 0.75rem; font-weight: 400; color: var(--ink-faint); }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.88rem; }
th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
thead th[data-sortable] { cursor: pointer; user-select: none; white-space: nowrap; }
thead th[data-sortable]::after { content: " \\2195"; color: var(--muted); }
thead th[aria-sort="ascending"]::after { content: " \\2191"; color: var(--ink); }
thead th[aria-sort="descending"]::after { content: " \\2193"; color: var(--ink); }
ul { margin: 0 0 0.6rem; padding-left: 1.1rem; }
li { margin: 0 0 0.2rem; }
details { border: 1px solid var(--rule); border-radius: 6px; margin: 0 0 0.5rem; background: var(--surface); }
summary { cursor: pointer; padding: 0.5rem 0.75rem; font-weight: 600; }
details > *:not(summary) { padding: 0 0.75rem 0.75rem; }
.group-subtitle { font-weight: 400; color: var(--ink-faint); margin-left: 0.5rem; }
.detail dt { font-weight: 600; font-size: 0.82rem; color: var(--ink-soft); margin-top: 0.5rem; }
.detail dd { margin: 0; white-space: pre-wrap; }
.replay { margin-top: 0.75rem; }
.replay-heading {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--ink-soft);
  margin: 0 0 0.35rem;
}
details.transcript { background: var(--surface-soft); margin: 0 0 0.35rem; }
details.transcript > summary { font-weight: 500; font-size: 0.9rem; }
.turns { list-style: none; padding-left: 0; margin: 0; }
.turn { margin: 0 0 0.5rem; }
.turn-meta { margin: 0 0 0.15rem; font-size: 0.72rem; }
.turn-role {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
}
.turn-index { color: var(--ink-faint); margin-left: 0.5rem; }
.turn-body {
  margin: 0;
  white-space: pre-wrap;
  /* Turn text is the one place a reader is reading the agent's own words, so it
     gets a measure of its own rather than the page's full width. */
  max-width: 46rem;
  border-left: 2px solid var(--rule);
  padding-left: 0.6rem;
}
.turn-gap {
  font-size: 0.75rem;
  color: var(--ink-faint);
  font-style: italic;
  margin: 0 0 0.5rem;
}
.note { color: var(--ink-soft); }
pre { overflow-x: auto; background: var(--surface-soft); border: 1px solid var(--rule); border-radius: 6px; padding: 0.75rem; margin: 0.5rem 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.82rem; }
.citations { color: var(--ink-faint); font-size: 0.78rem; list-style: none; padding-left: 0; }
.citations li { display: inline; margin-right: 0.6rem; }
.severity { font-size: 0.8rem; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.03em; }
.controls { margin: 0 0 1rem; }
.controls button {
  font: inherit;
  font-size: 0.82rem;
  padding: 0.25rem 0.7rem;
  margin-right: 0.4rem;
  border: 1px solid var(--rule);
  border-radius: 6px;
  background: var(--surface);
  cursor: pointer;
}
.tone-pass { color: var(--pass); }
.tone-fail { color: var(--fail); }
.tone-warn { color: var(--warn); }
.tone-muted { color: var(--muted); }
.tone-neutral { color: var(--neutral); }
.chart { display: block; max-width: 100%; height: auto; margin: 0.5rem 0; }
.spark { margin: 1.25rem 0 0; padding: 0; max-width: 32rem; }
.spark-caption {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
}
/* Held to a band. Stretched to the page it becomes a hero graphic, which is
   more weight than a four-point line has any claim to. */
.spark-chart { height: 3.5rem; width: 100%; }
.spark-ends {
  display: flex;
  justify-content: space-between;
  margin: 0;
  font-size: 0.78rem;
  color: var(--ink-faint);
}
.spark-now { font-weight: 600; color: var(--ink-soft); }
.chart .fill-pass { fill: var(--pass); }
.chart .fill-fail { fill: var(--fail); }
.chart .fill-warn { fill: var(--warn); }
.chart .fill-muted { fill: var(--muted); }
.chart .fill-neutral { fill: var(--neutral); }
.chart .chart-empty { fill: var(--rule); }
.chart .spark-line { fill: none; stroke: var(--neutral); stroke-width: 1.2; stroke-linejoin: round; }
.chart .spark-current { fill: var(--neutral); }
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
footer { color: var(--ink-soft); font-size: 0.85rem; }

@media print {
  body { background: #ffffff; padding: 0; font-size: 11pt; }
  main { max-width: none; }
  .no-print { display: none !important; }
  .card, details, pre { border-color: #cccccc; break-inside: avoid; }
  /* The script opens every disclosure before printing; this covers a reader
     who prints with scripting disabled, so detail is never printed away. */
  details > *:not(summary) { display: block !important; }
  thead th[data-sortable]::after { content: ""; }
  .visually-hidden {
    position: static;
    width: auto;
    height: auto;
    margin: 0;
    overflow: visible;
    clip: auto;
    white-space: normal;
  }
  .chart { display: none; }
  h2, h3 { break-after: avoid; }
  /* A transcript can run longer than a page, so it has to be allowed to break —
     otherwise the break-inside rule above pushes the whole conversation onto a
     fresh page and leaves the one before it half empty. Individual turns still
     stay whole. */
  details.transcript { break-inside: auto; }
  .turn { break-inside: avoid; }
}
`;

import type { Tone } from "../report.types";

/**
 * The token a {@link Tone} contributes to a class name.
 *
 * Lives beside the stylesheet that defines `.tone-*` and `.fill-*` so the two
 * stay together. The exhaustive switch means a new {@link Tone} fails to
 * compile until it is given a token here; it cannot also prove the stylesheet
 * grew a matching rule, so add the colour below in the same change.
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
/* The register is a lab report, not a dashboard: a document someone prints,
   forwards, and is expected to trust. So the ground is warm rather than clinical
   white, the accent is used for structure and never to mean "good" or "bad", and
   the severity colours are desaturated — a page of traffic lights reads as
   alarm, and this document is often mostly failures. Rank and label carry the
   meaning; colour only reinforces it, which is also what keeps it legible in
   greyscale print and to a colourblind reader. */
:root {
  --paper: #faf9f6;
  --surface: #ffffff;
  --surface-soft: #f4f2ed;
  --ink: #15191e;
  --ink-soft: #4c5661;
  --ink-faint: #838d97;
  --rule: #e4e1d9;
  --accent: #2f5d8c;
  --pass: #2c6e4b;
  --fail: #a13b33;
  --warn: #8a6416;
  --muted: #9aa3ac;
  --neutral: #2f5d8c;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  /* Serif headings against a sans body. The pairing is what separates a
     document from an app screen, and every face here ships with the OS —
     the file has to render from file:// with no network. */
  --serif: ui-serif, Georgia, Cambria, "Times New Roman", serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/* The viewer's own preference, honoured because this is opened from disk in
   whatever browser they use. Only the tokens change; nothing below restyles. */
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #14161a;
    --surface: #1b1e24;
    --surface-soft: #22262d;
    --ink: #e9e6e0;
    --ink-soft: #b3bac2;
    --ink-faint: #8b939c;
    --rule: #333941;
    --accent: #7aa9d8;
    --pass: #6fbf8f;
    --fail: #e08279;
    --warn: #d6a94a;
    --muted: #78818b;
    --neutral: #7aa9d8;
  }
}

* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2.5rem 1.25rem 4rem;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
main { max-width: 58rem; margin: 0 auto; }
h1, h2, h3, h4 { font-family: var(--serif); font-weight: 600; text-wrap: balance; }
h1 { font-size: 2rem; letter-spacing: -0.01em; margin: 0 0 0.35rem; }
/* The three acts. A rule above each turns them into the spine of the document
   rather than three headings that happen to be larger. */
h2 { font-size: 1.15rem; margin: 2.5rem 0 0.85rem; }
main > h2 {
  border-top: 1px solid var(--rule);
  padding-top: 1.1rem;
  text-transform: uppercase;
  font-size: 0.82rem;
  font-family: var(--sans);
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--ink-faint);
}
.card > h2:first-child { margin-top: 0; }
h3 { font-size: 1.1rem; margin: 1.5rem 0 0.35rem; }
h4 { font-size: 0.98rem; margin: 0 0 0.25rem; }
/* Prose keeps a measure; tables and charts are free to use the full column. */
p { margin: 0 0 0.65rem; max-width: 68ch; }
.card {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 10px;
  padding: 1.35rem 1.5rem;
  margin: 0 0 0.9rem;
}
.card > *:first-child { margin-top: 0; }
.card > *:last-child { margin-bottom: 0; }
.card > h3:first-child { margin-top: 0; }
.meta { color: var(--ink-faint); font-size: 0.85rem; margin: 0 0 0.75rem; max-width: none; }
.meta span { margin-right: 1rem; }
.summary { border-left: 3px solid var(--accent); }
.verdict {
  font-family: var(--serif);
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  margin: 0 0 0.3rem;
}
.verdict.tone-pass { color: var(--pass); }
.verdict.tone-fail { color: var(--fail); }
.verdict.tone-warn { color: var(--warn); }
.movement { color: var(--ink-soft); margin: 0 0 0.75rem; }
.summary-line { margin: 0.7rem 0 0; }
.summary-label {
  display: block;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
  margin-bottom: 0.1rem;
}
.summary-line.caveat { color: var(--ink-soft); }
.badge {
  display: inline-block;
  border: 1px solid var(--rule);
  border-radius: 999px;
  padding: 0.12rem 0.7rem;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.badge-verified { border-color: var(--pass); color: var(--pass); }
.badge-unchecked { border-color: var(--warn); color: var(--warn); }
.badge-figures_only { border-color: var(--muted); color: var(--ink-soft); }
.tier-note { color: var(--ink-soft); font-size: 0.9rem; margin: 0.5rem 0 0; }
.unchecked-prose {
  color: var(--ink-faint);
  font-size: 0.82rem;
  font-style: italic;
  margin: 0.35rem 0 0.5rem;
}
.headline-rate {
  font-family: var(--serif);
  font-size: 1.2rem;
  font-weight: 600;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}
.question { color: var(--ink-faint); font-size: 0.86rem; margin: 0 0 0.85rem; }
.gap { color: var(--ink-soft); font-style: italic; }
.stats { display: flex; flex-wrap: wrap; gap: 1.5rem; margin: 0.75rem 0; }
.stats div { min-width: 5.5rem; }
.stats dt {
  color: var(--ink-faint);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
}
/* Tabular figures throughout: this document is read by comparing numbers down a
   column, and proportional digits make that a worse job than it needs to be. */
.stats dd {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.stats .hint { display: block; font-size: 0.74rem; font-weight: 400; color: var(--ink-faint); }
.table-wrap { overflow-x: auto; }
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.88rem;
  font-variant-numeric: tabular-nums;
}
th, td { text-align: left; padding: 0.5rem 0.65rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
thead th {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
  border-bottom-color: var(--ink-faint);
}
tbody tr:last-child td { border-bottom: none; }
thead th[data-sortable] { cursor: pointer; user-select: none; white-space: nowrap; }
thead th[data-sortable]::after { content: " \\2195"; color: var(--muted); }
thead th[aria-sort="ascending"]::after { content: " \\2191"; color: var(--ink); }
thead th[aria-sort="descending"]::after { content: " \\2193"; color: var(--ink); }
ul { margin: 0 0 0.6rem; padding-left: 1.1rem; }
li { margin: 0 0 0.25rem; max-width: 68ch; }
details { border: 1px solid var(--rule); border-radius: 8px; margin: 0 0 0.5rem; background: var(--surface); }
summary { cursor: pointer; padding: 0.6rem 0.8rem; font-weight: 600; }
summary:hover { background: var(--surface-soft); }
details > *:not(summary) { padding: 0 0.8rem 0.8rem; }
.group-subtitle { font-weight: 400; color: var(--ink-faint); margin-left: 0.5rem; }
.detail dt {
  font-weight: 700;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--ink-faint);
  margin-top: 0.7rem;
}
.detail dd { margin: 0; white-space: pre-wrap; max-width: 68ch; }
.replay { margin-top: 1rem; }
.replay-heading {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--ink-faint);
  margin: 0 0 0.4rem;
}
details.transcript { background: var(--surface-soft); margin: 0 0 0.35rem; }
details.transcript > summary { font-weight: 500; font-size: 0.9rem; }
.turns { list-style: none; padding-left: 0; margin: 0; }
.turn { margin: 0 0 0.7rem; max-width: none; }
.turn-meta { margin: 0 0 0.2rem; font-size: 0.68rem; max-width: none; }
.turn-role {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--ink-soft);
}
.turn-index { color: var(--ink-faint); margin-left: 0.5rem; font-variant-numeric: tabular-nums; }
.turn-body {
  margin: 0;
  white-space: pre-wrap;
  /* Turn text is the one place a reader is reading the agent's own words, so it
     gets a measure of its own rather than the page's full width. */
  max-width: 62ch;
  border-left: 2px solid var(--rule);
  padding-left: 0.7rem;
  color: var(--ink-soft);
}
.turn-gap {
  font-size: 0.75rem;
  color: var(--ink-faint);
  font-style: italic;
  margin: 0 0 0.6rem;
}
.note { color: var(--ink-soft); }
pre { overflow-x: auto; background: var(--surface-soft); border: 1px solid var(--rule); border-radius: 8px; padding: 0.85rem; margin: 0.5rem 0; }
code { font-family: var(--mono); font-size: 0.82rem; }
.citations {
  color: var(--ink-faint);
  font-size: 0.74rem;
  list-style: none;
  padding-left: 0;
  font-family: var(--mono);
}
.citations li { display: inline; margin-right: 0.7rem; }
.severity { font-size: 0.7rem; font-weight: 700; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.07em; }
.controls { margin: 0 0 1.25rem; }
.controls button {
  font: inherit;
  font-size: 0.8rem;
  padding: 0.3rem 0.8rem;
  margin-right: 0.4rem;
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-soft);
  cursor: pointer;
}
.controls button:hover { border-color: var(--ink-faint); color: var(--ink); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tone-pass { color: var(--pass); }
.tone-fail { color: var(--fail); }
.tone-warn { color: var(--warn); }
.tone-muted { color: var(--muted); }
.tone-neutral { color: var(--ink-soft); }
.chart { display: block; max-width: 100%; height: auto; margin: 0.5rem 0; }
/* A proportion, not a hero. Left to scale by its own aspect ratio it became a
   seventy-five-pixel slab of colour — the loudest thing on the page, carrying
   information the counts beneath it already state exactly. */
.outcome-bar { height: 0.6rem; width: 100%; border-radius: 999px; overflow: hidden; margin: 0.9rem 0 1.1rem; }
.spark { margin: 1.5rem 0 0; padding: 0; max-width: 32rem; }
.spark-caption {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--ink-faint);
}
/* Held to a band. Stretched to the page it becomes a hero graphic, which is
   more weight than a four-point line has any claim to. */
.spark-chart { height: 3.5rem; width: 100%; }
.spark-ends {
  display: flex;
  justify-content: space-between;
  margin: 0.25rem 0 0;
  font-size: 0.76rem;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}
.spark-now { font-weight: 700; color: var(--ink-soft); }
.chart .fill-pass { fill: var(--pass); }
.chart .fill-fail { fill: var(--fail); }
.chart .fill-warn { fill: var(--warn); }
.chart .fill-muted { fill: var(--muted); }
.chart .fill-neutral { fill: var(--neutral); }
.chart .chart-empty { fill: var(--rule); }
.chart .spark-line { fill: none; stroke: var(--accent); stroke-width: 1.2; stroke-linejoin: round; }
.chart .spark-current { fill: var(--accent); }
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

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}

/* Print is always the light document, whatever the screen was set to: the
   tokens are re-pinned here rather than left to the dark scheme, which would
   otherwise put a near-black page through a printer. */
@media print {
  :root {
    --paper: #ffffff;
    --surface: #ffffff;
    --surface-soft: #f6f5f2;
    --ink: #000000;
    --ink-soft: #333333;
    --ink-faint: #666666;
    --rule: #cccccc;
    --accent: #24486d;
  }
  body { background: #ffffff; padding: 0; font-size: 10.5pt; }
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

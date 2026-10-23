import { CATEGORIES, FORM_FACTORS, type AuditRun, type Budgets, type Category } from "./budgets.ts";
import type { SeoIssue } from "./seo-check.ts";

/* The every-page Lighthouse and on-page search report: informational, never a gate. Layout
   follows the website's PR comment (specs/audit.feature, "Report every page"). */

export const ALL_PAGES_MARKER = "<!-- docs-lighthouse-all -->";
/** GitHub rejects a comment body over 65,536 characters; keep room for the link fallback. */
export const COMMENT_LIMIT = 65_000;
const WORST = 20;

const LABELS: Record<Category, string> = {
  performance: "Perf",
  accessibility: "A11y",
  "best-practices": "Best practices",
  seo: "SEO",
};
const DEVICES = { desktop: "🖥 Desktop", mobile: "📱 Mobile" } as const;
const ICONS = { desktop: "🖥", mobile: "📱" } as const;

/** On-page search checks, each named by the seo-check issue codes that fail it. */
const SEO_CHECKS = [
  ["Page exists", ["missing-page", "foreign-sitemap-url"]],
  ["One H1", ["h1-count"]],
  ["Title length", ["missing-title", "title-length"]],
  ["Meta description", ["missing-description", "description-length"]],
  ["Canonical", ["missing-canonical", "relative-canonical", "canonical-mismatch"]],
  ["Open Graph", ["missing-open-graph", "open-graph-image"]],
  ["Twitter card", ["missing-twitter-card"]],
  ["Structured data", ["missing-json-ld", "invalid-json-ld"]],
  ["lang and viewport", ["missing-document-basics"]],
  ["Indexable", ["noindex"]],
  ["Markdown twin", ["missing-markdown-link", "empty-markdown-export"]],
  ["In llms.txt", ["missing-from-llms-txt"]],
] as const;

/** Good and poor limits per metric (web.dev Core Web Vitals and Lighthouse's mobile curve). */
const METRICS = [
  ["firstContentfulPaint", "FCP", 1800, 3000],
  ["largestContentfulPaint", "LCP", 2500, 4000],
  ["totalBlockingTime", "TBT", 200, 600],
  ["cumulativeLayoutShift", "CLS", 0.1, 0.25],
  ["speedIndex", "Speed Index", 3400, 5800],
] as const;
type Metric = (typeof METRICS)[number][0];

export type PageSeo = { path: string; issues: string[] };
export type AllPagesInput = {
  /** Every sitemap page's site path, in sitemap order. */
  pages: string[];
  runs: AuditRun[];
  seo: PageSeo[];
  /** Issues not tied to one page: robots.txt, the not-found page, llms.txt. */
  siteIssues: SeoIssue[];
  budgets: Pick<Budgets, "categories">;
  commit?: string;
  /** Where the full table lives when it does not fit in the comment. */
  fullReportUrl?: string;
};

type Cell = number | null | undefined;

export function scoreDot(score: Cell) {
  if (score === null || score === undefined) return "⚪";
  return score >= 0.9 ? "🟢" : score >= 0.5 ? "🟠" : "🔴";
}

function score(value: Cell) {
  return value === null || value === undefined ? "⚪ n/a" : `${scoreDot(value)} ${Math.round(value * 100)}`;
}

function metricDot({ value, good, poor }: { value: Cell; good: number; poor: number }) {
  if (value === null || value === undefined) return "⚪";
  return value <= good ? "🟢" : value <= poor ? "🟠" : "🔴";
}

function metricValue({ metric, value }: { metric: Metric; value: Cell }) {
  if (value === null || value === undefined) return "n/a";
  if (metric === "cumulativeLayoutShift") return value.toFixed(3);
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function metricCell({ metric, value }: { metric: Metric; value: Cell }) {
  const [, , good, poor] = METRICS.find(([id]) => id === metric)!;
  return `${metricDot({ value, good, poor })} ${metricValue({ metric, value })}`;
}

function average(values: Cell[]) {
  const present = values.filter((value): value is number => typeof value === "number");
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length;
}

/** The 75th percentile, the share of page loads Core Web Vitals are judged on. */
function p75(values: Cell[]) {
  const sorted = values.filter((v): v is number => typeof v === "number").toSorted((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.ceil(sorted.length * 0.75) - 1];
}

function row(cells: string[]) {
  return `| ${cells.join(" | ")} |`;
}

function table(header: string[], rows: string[][]) {
  return [row(header), row(header.map(() => "---")), ...rows.map(row)];
}

function code(path: string) {
  return `\`${path}\``;
}

/** The section a page belongs to: its first path segment, or "Top level" for one-segment pages. */
export function sectionOf(path: string) {
  const segments = path.split("/").filter(Boolean);
  return segments.length > 1 ? segments[0] : "Top level";
}

/** One audited run per page and device; a later shard's run replaces an earlier one. */
export function indexRuns({ runs }: { runs: AuditRun[] }) {
  const byKey = new Map<string, AuditRun>();
  for (const run of runs) byKey.set(`${run.formFactor} ${run.path}`, run);
  return (formFactor: AuditRun["formFactor"], path: string) => byKey.get(`${formFactor} ${path}`);
}

function usable(run: AuditRun | undefined) {
  return run && !run.runtimeError ? run : undefined;
}

function agenticCell(run: AuditRun | undefined) {
  const agentic = usable(run)?.agentic;
  if (!agentic) return "⚪ n/a";
  return `${agentic.passed === agentic.applicable ? "🟢" : "🟠"} ${agentic.passed}/${agentic.applicable}`;
}

function seoCell(seo: PageSeo | undefined) {
  if (!seo) return "⚪ n/a";
  return seo.issues.length === 0 ? "✅" : `❌ ${seo.issues.map(code).join(", ")}`;
}

function budgetText({ budgets, formFactor }: { budgets: AllPagesInput["budgets"]; formFactor: AuditRun["formFactor"] }) {
  return CATEGORIES.map((category) => {
    const minimum = Math.round((budgets.categories[formFactor]?.[category] ?? 0) * 100);
    return `${LABELS[category]} ${minimum === 100 ? "= 100" : `≥ ${minimum}`}`;
  }).join(", ");
}

function headline({ input, run }: { input: AllPagesInput; run: ReturnType<typeof indexRuns> }) {
  const { pages, budgets, seo } = input;
  const lines = ["### 🏁 Headline", ""];
  const header = ["Profile", "Pages audited", ...CATEGORIES.map((c) => LABELS[c]), "Agentic browsing"];
  const rows = FORM_FACTORS.toReversed().map((formFactor) => {
    const audited = pages.map((path) => usable(run(formFactor, path))).filter((r) => r !== undefined);
    const cells = CATEGORIES.map((category) => {
      const scores = audited.map((r) => r.scores[category]);
      const minimum = budgets.categories[formFactor]?.[category] ?? 0;
      const passing = scores.filter((value) => typeof value === "number" && value >= minimum).length;
      return `${score(average(scores))} · ${passing}/${audited.length} pass`;
    });
    const agentic = audited.filter((r) => r.agentic && r.agentic.passed === r.agentic.applicable);
    return [
      DEVICES[formFactor],
      `${audited.length}/${pages.length}`,
      ...cells,
      `${agentic.length}/${audited.length} pass all`,
    ];
  });
  lines.push(...table(header, rows), "");
  for (const formFactor of FORM_FACTORS.toReversed())
    lines.push(`**${DEVICES[formFactor]} budget:** ${budgetText({ budgets, formFactor })}.  `);
  const clean = seo.filter((page) => page.issues.length === 0).length;
  lines.push(
    `**On-page SEO:** ${clean === seo.length ? "✅" : "❌"} ${clean}/${seo.length} pages pass every check.`,
    "",
    "Scores are averages; \"pass\" counts pages at or above the docs budget. Informational: the budgets gate only the representative pages in the `audit` job.",
    "",
  );
  return lines;
}

function vitals({ input, run }: { input: AllPagesInput; run: ReturnType<typeof indexRuns> }) {
  const header = ["Profile", ...METRICS.map(([, label]) => `${label} p75`), "Worst LCP"];
  const rows = FORM_FACTORS.toReversed().map((formFactor) => {
    const audited = input.pages.map((path) => usable(run(formFactor, path))).filter((r) => r !== undefined);
    const worst = audited.toSorted(
      (a, b) => (b.metrics.largestContentfulPaint ?? 0) - (a.metrics.largestContentfulPaint ?? 0),
    )[0];
    return [
      DEVICES[formFactor],
      ...METRICS.map(([metric]) =>
        metricCell({ metric, value: p75(audited.map((r) => r.metrics[metric])) }),
      ),
      worst
        ? `${metricCell({ metric: "largestContentfulPaint", value: worst.metrics.largestContentfulPaint })} ${code(worst.path)}`
        : "n/a",
    ];
  });
  return ["### ⏱ Core Web Vitals (lab, 75th percentile over pages)", "", ...table(header, rows), ""];
}

/** The pages scoring lowest in a category on either device, only those below 100. */
function worstPages({
  input,
  run,
  category,
}: {
  input: AllPagesInput;
  run: ReturnType<typeof indexRuns>;
  category: Category;
}) {
  const lowest = (path: string) =>
    Math.min(
      ...FORM_FACTORS.map((formFactor) => usable(run(formFactor, path))?.scores[category] ?? 1),
    );
  const below = input.pages
    .filter((path) => lowest(path) < 1)
    .toSorted((a, b) => lowest(a) - lowest(b) || a.localeCompare(b));
  const title = `#### ${LABELS[category]}`;
  if (below.length === 0) return [title, "", "Every audited page scores 100 on both devices.", ""];
  const extra =
    category === "performance" ? (["📱 LCP", "📱 TBT", "📱 CLS"] as const) : ([] as const);
  const metricOf = { "📱 LCP": "largestContentfulPaint", "📱 TBT": "totalBlockingTime", "📱 CLS": "cumulativeLayoutShift" } as const;
  const rows = below.slice(0, WORST).map((path) => [
    code(path),
    ...FORM_FACTORS.toReversed().map((formFactor) =>
      score(usable(run(formFactor, path))?.scores[category]),
    ),
    ...extra.map((label) =>
      metricCell({ metric: metricOf[label], value: usable(run("mobile", path))?.metrics[metricOf[label]] }),
    ),
  ]);
  const shown = Math.min(WORST, below.length);
  return [
    title,
    "",
    `${below.length} pages below 100 on a device; the worst ${shown}:`,
    "",
    ...table(["Page", "🖥 Desktop", "📱 Mobile", ...extra], rows),
    "",
  ];
}

function seoSection({ input }: { input: AllPagesInput }) {
  const lines = ["### 🔍 On-page SEO (static checks on every page)", ""];
  const failing = (codes: readonly string[]) =>
    input.seo.filter((page) => page.issues.some((issue) => codes.includes(issue))).length;
  const rows = SEO_CHECKS.map(([label, codes]) => {
    const failed = failing(codes);
    return [label, `${failed === 0 ? "✅" : "❌"} ${input.seo.length - failed}/${input.seo.length}`];
  });
  lines.push(...table(["Check", "Pages passing"], rows), "");
  const worst = input.seo
    .filter((page) => page.issues.length > 0)
    .toSorted((a, b) => b.issues.length - a.issues.length || a.path.localeCompare(b.path));
  if (worst.length > 0)
    lines.push(
      `<details><summary>${worst.length} pages with gaps (the worst ${Math.min(WORST, worst.length)})</summary>`,
      "",
      ...table(["Page", "Gaps"], worst.slice(0, WORST).map((page) => [code(page.path), page.issues.map(code).join(", ")])),
      "",
      "</details>",
      "",
    );
  if (input.siteIssues.length > 0)
    lines.push(
      "**Site-wide:** " +
        input.siteIssues.map((issue) => `${code(issue.page)} ${issue.code}`).join(", "),
      "",
    );
  return lines;
}

/** Pages a shard never reported, and runs Lighthouse could not finish, per device. */
function errors({ input, run }: { input: AllPagesInput; run: ReturnType<typeof indexRuns> }) {
  const lines: string[] = [];
  for (const formFactor of FORM_FACTORS.toReversed()) {
    const missing = input.pages.filter((path) => !run(formFactor, path));
    const failed = input.pages.flatMap((path) => {
      const error = run(formFactor, path)?.runtimeError;
      return error ? [`${code(path)}: ${error.replaceAll("\n", " ")}`] : [];
    });
    if (missing.length > 0)
      lines.push(
        `- ${DEVICES[formFactor]}: ${missing.length} pages not audited (a shard did not report), such as ${missing.slice(0, 5).map(code).join(", ")}`,
      );
    for (const line of failed.slice(0, 20)) lines.push(`- ${ICONS[formFactor]} ${line}`);
    if (failed.length > 20) lines.push(`- ${ICONS[formFactor]} and ${failed.length - 20} more Lighthouse errors`);
  }
  if (lines.length === 0) return [];
  return ["### ⚠️ Pages without scores", "", ...lines, ""];
}

/** Every page, grouped by section, each section folded. */
export function fullTable({ input }: { input: AllPagesInput }) {
  const run = indexRuns({ runs: input.runs });
  const seo = new Map(input.seo.map((page) => [page.path, page]));
  const sections = new Map<string, string[]>();
  for (const path of input.pages) sections.set(sectionOf(path), [...(sections.get(sectionOf(path)) ?? []), path]);
  const header = [
    "Page",
    ...FORM_FACTORS.toReversed().flatMap((formFactor) =>
      CATEGORIES.map((category) => `${ICONS[formFactor]} ${LABELS[category]}`),
    ),
    "📱 LCP",
    "📱 CLS",
    "Agentic 🖥 / 📱",
    "On-page SEO",
  ];
  const lines: string[] = [];
  for (const [section, paths] of [...sections].toSorted(([a], [b]) => a.localeCompare(b))) {
    const perf = FORM_FACTORS.toReversed().map(
      (formFactor) =>
        `${ICONS[formFactor]} ${score(average(paths.map((path) => usable(run(formFactor, path))?.scores.performance)))}`,
    );
    lines.push(
      `<details><summary><b>${section}</b>: ${paths.length} pages, average Perf ${perf.join(" ")}</summary>`,
      "",
    );
    const rows = paths.map((path) => {
      const mobile = usable(run("mobile", path));
      return [
        code(path),
        ...FORM_FACTORS.toReversed().flatMap((formFactor) =>
          CATEGORIES.map((category) => score(usable(run(formFactor, path))?.scores[category])),
        ),
        metricCell({ metric: "largestContentfulPaint", value: mobile?.metrics.largestContentfulPaint }),
        metricCell({ metric: "cumulativeLayoutShift", value: mobile?.metrics.cumulativeLayoutShift }),
        `${agenticCell(run("desktop", path))} / ${agenticCell(run("mobile", path))}`,
        seoCell(seo.get(path)),
      ];
    });
    lines.push(...table(header, rows), "", "</details>", "");
  }
  return lines;
}

function footer({ input }: { input: AllPagesInput }) {
  const commit = input.commit ? ` Commit \`${input.commit.slice(0, 7)}\`.` : "";
  return [
    `<sub>Lighthouse desktop and mobile presets, one run per page, on a production build served under /docs. 🟢 at 90 and above, 🟠 at 50, 🔴 below; vitals use the web.dev limits. Agentic browsing is Lighthouse's experimental checklist (checks passed / applicable).${commit}</sub>`,
  ];
}

/**
 * The PR comment and the full report. The comment carries the every-page table when it fits
 * under GitHub's limit and links `fullReportUrl` otherwise; `inline` says which.
 */
export function allPagesMarkdown({ input }: { input: AllPagesInput }) {
  const run = indexRuns({ runs: input.runs });
  const top = [
    ALL_PAGES_MARKER,
    "## ⚡ Lighthouse and SEO on every docs page",
    "",
    `_${input.pages.length} published pages, desktop and mobile. Informational, never a gate._`,
    "",
    ...headline({ input, run }),
    ...vitals({ input, run }),
    "### 📉 Lowest scoring pages",
    "",
    ...CATEGORIES.flatMap((category) => worstPages({ input, run, category })),
    ...seoSection({ input }),
    ...errors({ input, run }),
  ];
  const all = [`### 📋 Every page (${input.pages.length}), by section`, "", ...fullTable({ input })];
  const full = [...top, ...all, ...footer({ input })].join("\n") + "\n";
  if (full.length <= COMMENT_LIMIT) return { comment: full, full, inline: true };
  const link = input.fullReportUrl
    ? `The table of every page does not fit in a comment: it is in the [run summary](${input.fullReportUrl}) and the \`docs-lighthouse-all-report\` artifact.`
    : "The table of every page does not fit in a comment: it is in the run summary and the `docs-lighthouse-all-report` artifact.";
  const comment = [...top, `### 📋 Every page (${input.pages.length})`, "", link, "", ...footer({ input })].join("\n") + "\n";
  return { comment, full, inline: false };
}

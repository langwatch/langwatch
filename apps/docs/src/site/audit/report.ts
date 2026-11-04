import { CATEGORIES, formatScore, type AuditRun, type BudgetFinding } from "./budgets.ts";
import type { SeoIssue } from "./seo-check.ts";

const LABELS = { performance: "Perf", accessibility: "A11y", "best-practices": "BP", seo: "SEO" };

function milliseconds(value: number | null) {
  return value === null ? "n/a" : `${Math.round(value)} ms`;
}

function kilobytes(value: number | null) {
  return value === null ? "n/a" : `${Math.round(value / 1024)} KB`;
}

function escapeCell(text: string) {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** One row per page and device, then the agentic checks that failed anywhere. */
function runTable({ runs }: { runs: AuditRun[] }) {
  const header = [
    "Page",
    "Device",
    ...CATEGORIES.map((category) => LABELS[category]),
    "FCP",
    "LCP",
    "TBT",
    "CLS",
    "Speed Index",
    "Transfer",
    "Requests",
    "Agents",
  ];
  const rows = runs.map((run) => [
    `\`${run.path}\``,
    run.formFactor,
    ...CATEGORIES.map((category) => formatScore(run.scores[category])),
    milliseconds(run.metrics.firstContentfulPaint),
    milliseconds(run.metrics.largestContentfulPaint),
    milliseconds(run.metrics.totalBlockingTime),
    run.metrics.cumulativeLayoutShift === null
      ? "n/a"
      : run.metrics.cumulativeLayoutShift.toFixed(3),
    milliseconds(run.metrics.speedIndex),
    kilobytes(run.transferBytes),
    run.requests === null ? "n/a" : String(run.requests),
    run.agentic ? `${run.agentic.passed}/${run.agentic.applicable}` : "n/a",
  ]);
  const agentic = [
    ...new Set(runs.flatMap((run) => (run.agentic?.failed ?? []).map((id) => `\`${id}\``))),
  ];
  const table = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
  if (agentic.length === 0) return table;
  return [
    ...table,
    "",
    `Agents is Lighthouse's experimental agentic browsing checklist, reported and never gated; failing: ${agentic.join(", ")}.`,
  ];
}

/** The audit as Markdown: one row per page and device, then every failure and note. */
export function summaryMarkdown({
  runs,
  failures,
  notes,
  seo,
  wallClockMs,
  agentFailures = 0,
}: {
  runs: AuditRun[];
  failures: BudgetFinding[];
  notes: BudgetFinding[];
  seo: { pages: number; failures: SeoIssue[]; fixed: SeoIssue[]; known: number };
  wallClockMs: number;
  /** New agent readiness gaps; their section follows this summary. */
  agentFailures?: number;
}) {
  const lines = [
    `## Docs audit: ${failures.length + seo.failures.length + agentFailures === 0 ? "passed" : "failed"}`,
    "",
    `Lighthouse on ${runs.length} page runs in ${Math.round(wallClockMs / 1000)} s; static checks on ${seo.pages} pages (${seo.known} known gaps tolerated).`,
  ];
  if (runs.length > 0) lines.push("", ...runTable({ runs }));
  if (failures.length > 0) {
    lines.push("", "### Budget failures", "");
    for (const finding of failures)
      lines.push(
        `- \`${finding.page}\` ${finding.formFactor}: ${finding.code}, ${escapeCell(finding.detail)}`,
      );
  }
  if (seo.failures.length > 0) {
    lines.push("", "### Search and agent-readiness failures", "");
    for (const issue of seo.failures.slice(0, 200))
      lines.push(`- \`${issue.page}\`: ${issue.code}, ${escapeCell(issue.detail)}`);
    if (seo.failures.length > 200) lines.push(`- and ${seo.failures.length - 200} more`);
  }
  const tighten = [
    ...notes.map((note) => `\`${note.page}\`: ${note.detail}`),
    ...seo.fixed.map(
      (issue) => `\`${issue.page}\`: ${issue.code} is fixed; remove it from seo.known`,
    ),
  ];
  if (tighten.length > 0)
    lines.push("", "### Budgets that can be tightened", "", ...tighten.map((line) => `- ${line}`));
  return `${lines.join("\n")}\n`;
}

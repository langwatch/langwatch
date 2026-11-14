import type { AgentIssue } from "./agent-markdown.ts";
import { AGENT_CHECKS, type AgentReadiness } from "./agent-readiness.ts";

export type AgentGate = { failures: AgentIssue[]; fixed: AgentIssue[]; known: number };

/** Per check, its worst pages: heaviest first (tokens or block counts), then by address. */
export function worstPages({ issues, count = 10 }: { issues: AgentIssue[]; count?: number }) {
  return Object.fromEntries(
    AGENT_CHECKS.map((check) => {
      const codes = new Set<string>(check.codes);
      const pages = new Map<string, { page: string; weight: number; gaps: string[] }>();
      for (const issue of issues.filter((candidate) => codes.has(candidate.code))) {
        const entry = pages.get(issue.page) ?? { page: issue.page, weight: 0, gaps: [] };
        entry.weight += issue.weight ?? 1;
        entry.gaps.push(issue.detail);
        pages.set(issue.page, entry);
      }
      const sorted = [...pages.values()].toSorted(
        (a, b) => b.weight - a.weight || a.page.localeCompare(b.page),
      );
      return [check.id, sorted.slice(0, count)];
    }),
  );
}

/** The trend record a later job reads: score, checks, totals, offenders and the gate. */
export function agentReadinessReport({
  result,
  gate,
}: {
  result: AgentReadiness;
  gate: AgentGate;
}) {
  const { issues, ...rest } = result;
  return {
    ...rest,
    issues: issues.length,
    worstPages: worstPages({ issues }),
    gate: { new: gate.failures, fixed: gate.fixed, known: gate.known },
  };
}

function escapeCell(text: string) {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

const thousands = (value: number) => value.toLocaleString("en-GB");

/** The step summary section: score, pass rate per check, token totals, offenders and the delta. */
export function agentReadinessMarkdown({
  result,
  gate,
}: {
  result: AgentReadiness;
  gate: AgentGate;
}) {
  const { tokens, freshness } = result;
  const lines = [
    "",
    `## Agent readiness: ${result.score}/100, ${gate.failures.length === 0 ? "no new gaps" : `${gate.failures.length} new gaps`}`,
    "",
    `${result.pages} pages read from their Markdown exports, ${result.integrationPages} of them integration pages; ${gate.known} known gaps tolerated, ${gate.fixed.length} fixed.`,
    "",
    "| Check | Passing | Pages | Rate |",
    "| --- | --- | --- | --- |",
    ...result.checks.map(
      (check) =>
        `| ${check.label} | ${check.applicable - check.failing} | ${check.applicable} | ${Math.round(check.passRate * 100)}% |`,
    ),
    "",
    `Tokens (${tokens.tokeniser}): llms.txt ${thousands(tokens.llmsTxt)}, llms-full.txt ${thousands(tokens.llmsFull)}; page budget ${thousands(tokens.pageBudget)}. Largest pages: ${tokens.largestPages
      .slice(0, 5)
      .map((page) => `\`${page.page}\` ${thousands(page.tokens)}`)
      .join(", ")}.`,
    "",
    `Freshness: ${freshness.dated} of ${freshness.total} sitemap pages carry a last-modified date. Dates come from git, so a shallow checkout dates fewer pages; the production build needs the full history.`,
  ];
  const worst = worstPages({ issues: result.issues, count: 5 });
  const offenders = AGENT_CHECKS.filter((check) => (worst[check.id]?.length ?? 0) > 0);
  if (offenders.length > 0) {
    lines.push("", "<details><summary>Worst pages per check</summary>", "");
    for (const check of offenders)
      lines.push(
        `- **${check.label}**: ${(worst[check.id] ?? []).map((entry) => `\`${entry.page}\` (${escapeCell(entry.gaps.join("; "))})`).join(", ")}`,
      );
    lines.push("", "</details>");
  }
  if (gate.failures.length > 0) {
    lines.push("", "### New agent readiness gaps", "");
    for (const issue of gate.failures.slice(0, 100))
      lines.push(`- \`${issue.page}\`: ${issue.code}, ${escapeCell(issue.detail)}`);
    if (gate.failures.length > 100) lines.push(`- and ${gate.failures.length - 100} more`);
  }
  if (gate.fixed.length > 0) {
    lines.push("", "### Known agent readiness gaps that are fixed", "");
    for (const issue of gate.fixed.slice(0, 100))
      lines.push(`- \`${issue.page}\`: ${issue.code}; remove it from agentReadiness.known`);
  }
  return `${lines.join("\n")}\n`;
}

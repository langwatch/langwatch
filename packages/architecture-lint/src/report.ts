import type { ArchitectureViolation } from "./types.ts";

/**
 * One lint run, rendered for the agent that has to act on it: the summary
 * first, then the findings grouped by the policy that refused them.
 */

/** How many findings one policy prints before the rest are counted instead. */
export const POLICY_FINDING_CAP = 25;

export type PolicyGroup = {
  policy: string;
  findings: readonly ArchitectureViolation[];
  /** Baseline rows this policy reports as no longer earning their keep. */
  staleRows: number;
};

export type LintReport = {
  groups: readonly PolicyGroup[];
  findingCount: number;
  staleRowCount: number;
  policyCount: number;
  exitCode: 0 | 1;
  /** Why the exit code is what it is, in the words the summary prints. */
  reason: string;
};

/**
 * A stale baseline row is a finding saying an allowance no longer applies.
 * Every ratchet reports one through `baseline.ts`, which sets the field; the
 * report never reads the prose to guess.
 */
export function isStaleBaselineRow(finding: ArchitectureViolation): boolean {
  return finding.stale === true;
}

/** `[policy] file:line`, the message, and the way out when the policy names one. */
export function formatFinding(finding: ArchitectureViolation): string {
  const location = `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
  const specifier = finding.specifier ? ` (${finding.specifier})` : "";
  const allowed = finding.allowed ? `\n  allowed: ${finding.allowed}` : "";

  return `[${finding.policy}] ${location}${specifier}\n  ${finding.message}${allowed}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function groupByPolicy(findings: readonly ArchitectureViolation[]): PolicyGroup[] {
  const byPolicy = new Map<string, ArchitectureViolation[]>();

  for (const finding of findings) {
    const existing = byPolicy.get(finding.policy);

    if (existing) existing.push(finding);
    else byPolicy.set(finding.policy, [finding]);
  }

  const groups = [...byPolicy.entries()].map(([policy, policyFindings]) => ({
    policy,
    findings: policyFindings,
    staleRows: policyFindings.filter(isStaleBaselineRow).length,
  }));

  return groups.sort(
    (a, b) => b.findings.length - a.findings.length || a.policy.localeCompare(b.policy),
  );
}

function reasonFor(findingCount: number, staleRowCount: number): string {
  if (findingCount === 0) return "no policy refused anything";

  if (staleRowCount === 0) return plural(findingCount, "finding");

  const refusals = plural(findingCount - staleRowCount, "finding");

  return `${refusals} and ${plural(staleRowCount, "stale baseline row")}`;
}

export function buildReport(findings: readonly ArchitectureViolation[]): LintReport {
  const groups = groupByPolicy(findings);
  const staleRowCount = groups.reduce((total, group) => total + group.staleRows, 0);

  return {
    groups,
    findingCount: findings.length,
    staleRowCount,
    policyCount: groups.length,
    exitCode: findings.length === 0 ? 0 : 1,
    reason: reasonFor(findings.length, staleRowCount),
  };
}

function summaryLines(report: LintReport, all: boolean): string[] {
  if (report.findingCount === 0) {
    return ["architecture-lint: 0 findings, exit 0 (no policy refused anything)"];
  }

  const overCap = report.groups.some((group) => group.findings.length > POLICY_FINDING_CAP);
  const policies = report.policyCount === 1 ? "1 policy" : `${report.policyCount} policies`;
  const total = plural(report.findingCount, "finding");

  const lines = [
    `architecture-lint: ${total} across ${policies}, exit ${report.exitCode} (${report.reason})`,
  ];

  for (const group of report.groups) {
    const stale = group.staleRows > 0 ? `  (${group.staleRows} stale baseline)` : "";

    lines.push(`  ${String(group.findings.length).padStart(5)}  ${group.policy}${stale}`);
  }

  if (overCap && !all) {
    lines.push(
      `  showing at most ${POLICY_FINDING_CAP} findings per policy; pass --all for every one`,
    );
  }

  return lines;
}

function groupLines(group: PolicyGroup, all: boolean): string[] {
  const shown = all ? group.findings : group.findings.slice(0, POLICY_FINDING_CAP);
  const hidden = group.findings.length - shown.length;

  const lines = [
    "",
    `--- ${group.policy}: ${plural(group.findings.length, "finding")} ---`,
    "",
    shown.map(formatFinding).join("\n\n"),
  ];

  if (hidden > 0) {
    lines.push(
      "",
      `  ${plural(hidden, "further finding")} from ${group.policy}, hidden by the cap`,
    );
  }

  return lines;
}

/** The whole report as text. No colour codes: the reader is usually an agent. */
export function formatReport(report: LintReport, { all = false } = {}): string {
  const lines = summaryLines(report, all);

  for (const group of report.groups) lines.push(...groupLines(group, all));

  return `${lines.join("\n")}\n`;
}

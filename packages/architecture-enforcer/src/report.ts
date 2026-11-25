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
};

export type LintReport = {
  groups: readonly PolicyGroup[];
  findingCount: number;
  policyCount: number;
  exitCode: 0 | 1;
  /** Why the exit code is what it is, in the words the summary prints. */
  reason: string;
};

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
  }));

  return groups.toSorted(
    (a, b) => b.findings.length - a.findings.length || a.policy.localeCompare(b.policy),
  );
}

function reasonFor(findingCount: number): string {
  return findingCount === 0 ? "no policy refused anything" : plural(findingCount, "finding");
}

export function buildReport(findings: readonly ArchitectureViolation[]): LintReport {
  const groups = groupByPolicy(findings);

  return {
    groups,
    findingCount: findings.length,
    policyCount: groups.length,
    exitCode: findings.length === 0 ? 0 : 1,
    reason: reasonFor(findings.length),
  };
}

function summaryLines(report: LintReport, all: boolean): string[] {
  if (report.findingCount === 0) {
    return ["architecture-enforcer: 0 findings, exit 0 (no policy refused anything)"];
  }

  const overCap = report.groups.some((group) => group.findings.length > POLICY_FINDING_CAP);
  const policies = report.policyCount === 1 ? "1 policy" : `${report.policyCount} policies`;
  const total = plural(report.findingCount, "finding");

  const lines = [
    `architecture-enforcer: ${total} across ${policies}, exit ${report.exitCode} (${report.reason})`,
  ];

  for (const group of report.groups) {
    lines.push(`  ${String(group.findings.length).padStart(5)}  ${group.policy}`);
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

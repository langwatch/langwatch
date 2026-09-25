// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SeedRunReport } from "@langwatch/enterprise-seed-demo-contract";

export function reportHasFailures(report: SeedRunReport): boolean {
  return report.actions.some((a) => a.outcome.status === "failed");
}

function outcomeDetail(outcome: SeedRunReport["actions"][number]["outcome"]): string {
  if (outcome.status === "succeeded") return outcome.summary;
  if (outcome.status === "skipped") return outcome.reason;
  return outcome.error;
}

export function formatReport(report: SeedRunReport): string {
  const lines = [
    "Demo seed run report",
    "====================",
    `Org: ${report.organizationName} (${report.organizationId})`,
    `Mode: ${report.mode === "execute" ? "EXECUTE" : "DRY-RUN"}`,
    `Started: ${report.startedAt}`,
    `Completed: ${report.completedAt}`,
    "",
    "Actions:",
  ];
  for (const action of report.actions) {
    const o = action.outcome;
    const detail = outcomeDetail(o);
    lines.push(`  ${action.name} (${action.durationMs}ms): ${o.status} ${detail}`);
  }
  lines.push("");
  lines.push(
    reportHasFailures(report)
      ? "Result: at least one action failed."
      : "Result: all actions ran clean.",
  );
  return lines.join("\n");
}

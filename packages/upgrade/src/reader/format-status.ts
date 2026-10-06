import type { UpgradeStatus } from "./reader.schema.ts";

function formatInstant({ instant }: { instant: string | null }): string {
  return instant ?? "unknown";
}

/**
 * The plain text `upgrade status` prints (`--json` prints the status as the schema has it).
 * A step status the reader does not know appears in the counts exactly as stored.
 */
export function formatStatus({ status }: { status: UpgradeStatus }): string {
  const counts = Object.entries(status.counts)
    .toSorted(([left], [right]) => left.localeCompare(right, "en"))
    .map(([name, count]) => `${name} ${count}`);
  const lines = [
    `Installation: ${status.label} (${status.tone})`,
    status.summary,
    "",
    `Installed:    ${status.installed ?? "no release recorded"}${status.origin === "inferred" ? " (inferred from another tool's record)" : ""}`,
    `Image:        ${status.image}`,
    `Floor:        ${status.floor ?? "none"}${status.ledgerFloor ? ` (the ledger was last upgraded with ${status.ledgerFloor})` : ""}`,
    `Steps:        ${counts.length > 0 ? counts.join(", ") : "none recorded"}`,
  ];
  if (status.failedStepIds.length > 0) {
    lines.push(`Failed steps: ${status.failedStepIds.join(", ")}`);
  }
  if (status.failedTargets > 0) lines.push(`Failed targets: ${status.failedTargets}`);
  if (status.lease) {
    const { owner, host, image, expiresAt } = status.lease;
    lines.push(
      `Lease:        held by ${owner ?? "unknown"} on ${host ?? "unknown"} (${image ?? "unknown image"}) until ${formatInstant({ instant: expiresAt })}`,
    );
  }
  if (status.lastRun) {
    const run = status.lastRun;
    lines.push(
      `Last run:     ${run.id} (${run.kind}) ${run.outcome ?? "unfinished"}, started ${formatInstant({ instant: run.startedAt })}`,
    );
  }
  return lines.join("\n");
}

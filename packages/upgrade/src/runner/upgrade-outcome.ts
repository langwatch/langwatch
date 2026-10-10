import { z } from "zod";

import type { UpgradePlan } from "../plan/plan-upgrade.ts";
import type { ContractArchiveEntry } from "./contract-archive/contract-archive.service.ts";

export const upgradeOutcomeCodeSchema = z.enum([
  "done",
  "refused_below_floor",
  "refused_image_below_floor",
  "lease_not_acquired",
  "lease_lost",
  "failed_prisma_migration",
  "rerunnable_migration_failed",
  "schema_failed",
  "step_failed",
  "reconciler_failed",
  "failed",
]);
export type UpgradeOutcomeCode = z.infer<typeof upgradeOutcomeCodeSchema>;

/** Exit codes of `pnpm task upgrade`: 0 done, 1 failed, 2 refused (floor), 3 lease not acquired. */
export const upgradeExitCodeSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type UpgradeExitCode = z.infer<typeof upgradeExitCodeSchema>;

export const upgradeOutcomeSchema = z.object({
  exitCode: upgradeExitCodeSchema,
  code: upgradeOutcomeCodeSchema,
  message: z.string(),
  runId: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()),
});
export type UpgradeOutcome = z.infer<typeof upgradeOutcomeSchema>;

export const EXIT_CODES: Record<UpgradeOutcomeCode, UpgradeExitCode> = {
  done: 0,
  refused_below_floor: 2,
  refused_image_below_floor: 2,
  lease_not_acquired: 3,
  lease_lost: 1,
  failed_prisma_migration: 1,
  rerunnable_migration_failed: 1,
  schema_failed: 1,
  step_failed: 1,
  reconciler_failed: 1,
  failed: 1,
};

export function upgradeOutcome({
  code,
  message,
  runId = null,
  detail = {},
}: {
  code: UpgradeOutcomeCode;
  message: string;
  runId?: string | null;
  detail?: Record<string, unknown>;
}): UpgradeOutcome {
  return { exitCode: EXIT_CODES[code], code, message, runId, detail };
}

/** A failure inside a run, carried to the run's end where it is recorded and reported. */
export class UpgradeRunFailure extends Error {
  constructor(
    readonly code: Exclude<UpgradeOutcomeCode, "done">,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "UpgradeRunFailure";
  }
}

/** The plain text `upgrade plan` prints; `--json` prints the plan itself. */
export function formatPlan({
  installed,
  plan,
  archives = [],
}: {
  installed: string | null;
  plan: UpgradePlan;
  archives?: readonly ContractArchiveEntry[];
}): string {
  if (plan.outcome === "refused") return `Refused (${plan.code}): ${plan.message}`;
  const lines = [
    plan.fresh
      ? "Fresh install: every schema step applies at once."
      : `Installed: ${installed ?? "unknown"}`,
  ];
  const list = (label: string, ids: readonly string[]) =>
    ids.length > 0 ? [`  ${label} (${ids.length}): ${ids.join(", ")}`] : [];
  for (const release of plan.releases) {
    lines.push(`${release.release ?? "unreleased"}${release.virtual ? " (virtual release)" : ""}:`);
    lines.push(
      ...list("schema", release.schema),
      ...list("blocking", release.blocking),
      ...list("background, on the worker", release.background),
      ...list("operator", release.operator),
    );
  }
  if (archives.length > 0) lines.push(`Archived before a contract drops it (${archives.length}):`);
  for (const { step, table, archive, state, rows, reason } of archives) {
    const detail = reason ?? `${rows ?? "no"} rows`;
    lines.push(`  ${step}: ${table} -> ${archive} (${state}, ${detail})`);
  }
  if (plan.notNeeded.length > 0)
    lines.push(`Not needed on a fresh install: ${plan.notNeeded.length}`);
  if (lines.length === 1) lines.push("Nothing to do: the ledger is current.");
  return lines.join("\n");
}

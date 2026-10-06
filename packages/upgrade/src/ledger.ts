import { z } from "zod";

/** Step kinds, modes and statuses: dev/docs/plans/migrations-rethink-2026-10-06.md 6.1 and 6.6. */
export const upgradeStepKindSchema = z.enum([
  "postgres-schema",
  "clickhouse-schema",
  "data",
  "tenant",
  "procedure",
]);
export type UpgradeStepKind = z.infer<typeof upgradeStepKindSchema>;

export const upgradeStepModeSchema = z.enum(["blocking", "background", "operator"]);
export type UpgradeStepMode = z.infer<typeof upgradeStepModeSchema>;

export const upgradeStepStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "not-needed",
  "failed",
  "gated",
]);
export type UpgradeStepStatus = z.infer<typeof upgradeStepStatusSchema>;

export const upgradeRunKindSchema = z.enum(["seed", "upgrade"]);
export type UpgradeRunKind = z.infer<typeof upgradeRunKindSchema>;

export const upgradeRunOutcomeSchema = z.enum(["succeeded", "failed"]);
export type UpgradeRunOutcome = z.infer<typeof upgradeRunOutcomeSchema>;

const reportSchema = z.record(z.string(), z.unknown());

/** One row of `_langwatch_upgrade_step`. `inferred` marks a row read from another tool's record. */
export const upgradeStepSchema = z.object({
  id: z.string(),
  kind: upgradeStepKindSchema,
  release: z.string().nullable(),
  mode: upgradeStepModeSchema,
  status: upgradeStepStatusSchema,
  inferred: z.boolean(),
  attempt: z.number().int(),
  lastError: z.string().nullable(),
  report: reportSchema.nullable(),
  runId: z.string().nullable(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  updatedAt: z.date(),
});
export type UpgradeStep = z.infer<typeof upgradeStepSchema>;

/** One row of `_langwatch_upgrade_run`. */
export const upgradeRunSchema = z.object({
  id: z.string(),
  kind: upgradeRunKindSchema,
  release: z.string().nullable(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
  outcome: upgradeRunOutcomeSchema.nullable(),
  plan: reportSchema.nullable(),
  report: reportSchema.nullable(),
});
export type UpgradeRun = z.infer<typeof upgradeRunSchema>;

/** What a seed knows of a step: the rest of the row is the ledger's own. */
export type InferredStep = Pick<UpgradeStep, "id" | "kind" | "mode" | "status" | "lastError">;

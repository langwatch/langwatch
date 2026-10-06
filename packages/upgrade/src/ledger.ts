import { z } from "zod";

/** Step kinds, modes and statuses: dev/docs/plans/migrations-rethink-2026-10-06.md 6.1 and 6.6. */
export const upgradeStepKindSchema = z.enum([
  "postgres-schema",
  "clickhouse-schema",
  "data",
  "tenant",
  "procedure",
  "event-upcast",
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
  owner: z.string().nullable(),
  description: z.string().nullable(),
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
  floor: z.string().nullable(),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
  outcome: upgradeRunOutcomeSchema.nullable(),
  plan: reportSchema.nullable(),
  report: reportSchema.nullable(),
});
export type UpgradeRun = z.infer<typeof upgradeRunSchema>;

/** What a seed knows of a step: the rest of the row is the ledger's own. */
export type InferredStep = Pick<UpgradeStep, "id" | "kind" | "mode" | "status" | "lastError">;

/** A step as its declaring module states it: the rest of its row is the ledger's own. */
export const declaredStepSchema = z.object({
  id: z.string().min(1),
  kind: upgradeStepKindSchema,
  mode: upgradeStepModeSchema,
  owner: z.string().min(1),
  description: z.string().min(1),
});
export type DeclaredStep = z.infer<typeof declaredStepSchema>;

/** One row of `_langwatch_upgrade_target`: one target of a step, such as a ClickHouse endpoint. */
export const upgradeTargetSchema = z.object({
  stepId: z.string(),
  target: z.string(),
  status: upgradeStepStatusSchema,
  version: z.string().nullable(),
  lastError: z.string().nullable(),
  updatedAt: z.date(),
});
export type UpgradeTarget = z.infer<typeof upgradeTargetSchema>;

/** One row of `_langwatch_upgrade_lease`: who holds the runner lease and until when. */
export const upgradeLeaseSchema = z.object({
  name: z.string(),
  owner: z.string(),
  image: z.string(),
  host: z.string(),
  heartbeatAt: z.date(),
  expiresAt: z.date(),
});
export type UpgradeLease = z.infer<typeof upgradeLeaseSchema>;

/** One row of `_langwatch_upgrade_presence`: a serving process and the steps its image declares. */
export const upgradePresenceSchema = z.object({
  processId: z.string(),
  role: z.string(),
  image: z.string(),
  release: z.string().nullable(),
  steps: z.array(z.string()),
  startedAt: z.date(),
  heartbeatAt: z.date(),
});
export type UpgradePresence = z.infer<typeof upgradePresenceSchema>;

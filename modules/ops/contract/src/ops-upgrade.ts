/**
 * The Upgrades pages' six reads (round 8, U2-API), in ops' own shapes: ops' service maps
 * UpgradeReader's answers into them, so this contract imports no framework but the module's.
 * Each is asked at `ops:view` on the platform. Spec: modules/ops/specs/upgrades.feature
 */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

const isoInstant = z.string();
const countsSchema = z.record(z.string(), z.number().int());
const reportSchema = z.record(z.string(), z.unknown()).nullable();

/** One page: `cursor` is null on the last page, and on every read that is not paged. */
function opsUpgradePageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({ items: z.array(item), cursor: z.string().nullable() });
}

export const opsUpgradeRunSummarySchema = z.object({
  id: z.string(),
  kind: z.string(),
  release: z.string().nullable(),
  floor: z.string().nullable(),
  startedAt: isoInstant,
  finishedAt: isoInstant.nullable(),
  outcome: z.string().nullable(),
});
export type OpsUpgradeRunSummary = z.infer<typeof opsUpgradeRunSummarySchema>;

export const opsUpgradeLeaseSchema = z.object({
  name: z.string().nullable(),
  owner: z.string().nullable(),
  image: z.string().nullable(),
  host: z.string().nullable(),
  heartbeatAt: isoInstant.nullable(),
  expiresAt: isoInstant.nullable(),
});
export type OpsUpgradeLease = z.infer<typeof opsUpgradeLeaseSchema>;

/** Where the installation stands; `state`, `tone` and `reason` are the reader's words, raw. */
export const opsUpgradeStatusSchema = z.object({
  state: z.string(),
  label: z.string(),
  tone: z.string(),
  reason: z.string(),
  summary: z.string(),
  installed: z.string().nullable(),
  origin: z.string(),
  image: z.string(),
  floor: z.string().nullable(),
  ledgerFloor: z.string().nullable(),
  lease: opsUpgradeLeaseSchema.nullable(),
  lastRun: opsUpgradeRunSummarySchema.nullable(),
  counts: countsSchema,
  failedStepIds: z.array(z.string()),
  failedTargets: z.number().int(),
});
export type OpsUpgradeStatus = z.infer<typeof opsUpgradeStatusSchema>;

export const opsUpgradeReleaseSchema = z.object({
  release: z.string().nullable(),
  installed: z.boolean(),
  image: z.boolean(),
  stepCount: z.number().int(),
  counts: countsSchema,
});
export type OpsUpgradeRelease = z.infer<typeof opsUpgradeReleaseSchema>;

export const opsUpgradeStepSchema = z.object({
  id: z.string(),
  kind: z.string(),
  release: z.string().nullable(),
  mode: z.string(),
  status: z.string(),
  statusLabel: z.string(),
  owner: z.string().nullable(),
  description: z.string().nullable(),
  recorded: z.boolean(),
  inferred: z.boolean(),
  attempt: z.number().int(),
  lastError: z.string().nullable(),
  report: reportSchema,
  runId: z.string().nullable(),
  startedAt: isoInstant.nullable(),
  finishedAt: isoInstant.nullable(),
  updatedAt: isoInstant.nullable(),
});
export type OpsUpgradeStep = z.infer<typeof opsUpgradeStepSchema>;

export const opsUpgradeTargetSchema = z.object({
  target: z.string(),
  status: z.string(),
  version: z.string().nullable(),
  lastError: z.string().nullable(),
  updatedAt: isoInstant.nullable(),
});
export type OpsUpgradeTarget = z.infer<typeof opsUpgradeTargetSchema>;

export const opsUpgradeStepDetailSchema = z.object({
  ...opsUpgradeStepSchema.shape,
  targets: z.array(opsUpgradeTargetSchema),
});
export type OpsUpgradeStepDetail = z.infer<typeof opsUpgradeStepDetailSchema>;

/** One phase of a run's report (round 9, U2-PHASES); an unknown name or outcome reads raw. */
export const opsUpgradeRunPhaseSchema = z.object({
  name: z.string(),
  release: z.string().nullable(),
  startedAt: isoInstant,
  finishedAt: isoInstant.nullable(),
  outcome: z.string(),
});
export type OpsUpgradeRunPhase = z.infer<typeof opsUpgradeRunPhaseSchema>;

export const opsUpgradeRunSchema = z.object({
  ...opsUpgradeRunSummarySchema.shape,
  plan: reportSchema,
  report: reportSchema,
  phases: z.array(opsUpgradeRunPhaseSchema),
  steps: z.array(opsUpgradeStepSchema),
});
export type OpsUpgradeRun = z.infer<typeof opsUpgradeRunSchema>;

export const opsUpgradeReleasePageSchema = opsUpgradePageSchema(opsUpgradeReleaseSchema);
export type OpsUpgradeReleasePage = z.infer<typeof opsUpgradeReleasePageSchema>;
export const opsUpgradeStepPageSchema = opsUpgradePageSchema(opsUpgradeStepSchema);
export type OpsUpgradeStepPage = z.infer<typeof opsUpgradeStepPageSchema>;
export const opsUpgradeRunPageSchema = opsUpgradePageSchema(opsUpgradeRunSummarySchema);
export type OpsUpgradeRunPage = z.infer<typeof opsUpgradeRunPageSchema>;

/** The steps of one release (null: unreleased), mode or status. */
export const opsUpgradeListStepsInputSchema = z.object({
  release: z.string().nullable().optional(),
  mode: z.string().optional(),
  status: z.string().optional(),
});
export type OpsUpgradeListStepsInput = z.infer<typeof opsUpgradeListStepsInputSchema>;

export const opsUpgradeListRunsInputSchema = z.object({
  cursor: z.string().nullable().optional(),
  limit: z.number().int().positive().optional(),
});
export type OpsUpgradeListRunsInput = z.infer<typeof opsUpgradeListRunsInputSchema>;

/** One step or run, by the id the ledger records it under. */
export const opsUpgradeIdInputSchema = z.object({ id: z.string().min(1) });
export type OpsUpgradeIdInput = z.infer<typeof opsUpgradeIdInputSchema>;

export const opsUpgradeTrpc = defineTrpcContract("ops.upgrade")
  /** Where the installation stands: installed, image and floor releases, lease and last run. */
  .query("status")
  .withInput(z.void())
  .withOutput(opsUpgradeStatusSchema)

  /** Every release the ledger or the image knows, with its step counts. */
  .query("listReleases")
  .withInput(z.void())
  .withOutput(opsUpgradeReleasePageSchema)

  .query("listSteps")
  .withInput(opsUpgradeListStepsInputSchema)
  .withOutput(opsUpgradeStepPageSchema)

  /** One step with its per-target rows; `upgrade_not_found` when the ledger holds none. */
  .query("getStep")
  .withInput(opsUpgradeIdInputSchema)
  .withOutput(opsUpgradeStepDetailSchema)

  /** The recorded runs, newest first, one page at a time. */
  .query("listRuns")
  .withInput(opsUpgradeListRunsInputSchema)
  .withOutput(opsUpgradeRunPageSchema)

  /** One run with its phases, steps, plan and report; `upgrade_not_found` when unknown. */
  .query("getRun")
  .withInput(opsUpgradeIdInputSchema)
  .withOutput(opsUpgradeRunSchema)
  .build();

/**
 * The Upgrades pages' six reads (round 8, U2-API) and the ten operator system-migration
 * procedures, in ops' own shapes: ops' service maps UpgradeReader's answers into them. Reads
 * ask `ops:view` on the platform, writes `ops:manage`. Spec: modules/ops/specs/upgrades.feature
 */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  opsMigrationDrainAssertedSchema,
  opsMigrationEnrolledSchema,
  opsMigrationPassStartedSchema,
  opsMigrationRolledBackSchema,
  opsMigrationWithdrawnSchema,
} from "../../ops.responses.ts";
import {
  opsAssertLegacyWritersDrainedInputSchema,
  opsEnrollMigrationCohortInputSchema,
  opsEnrollMigrationTenantInputSchema,
  opsMigrationCohortResultSchema,
  opsMigrationEnrollmentListingSchema,
  opsMigrationOrganizationMatchSchema,
  opsMigrationOverviewSchema,
  opsMigrationTargetedRunResultSchema,
  opsMigrationTenantInputSchema,
  opsRollBackSystemMigrationTenantInputSchema,
  opsRunSystemMigrationForOrganizationInputSchema,
  opsSearchMigrationOrganizationsInputSchema,
} from "./ops-system-migration.ts";

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

/** A step's `done` of `total` from its checkpoint report (STEP-PROGRESS, Alex 2026-10-09). */
export const opsUpgradeStepProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});

/** A live serving process a step waits on: its image does not know the step (STEP-WAITINGON). */
export const opsUpgradeWaitingWriterSchema = z.object({
  role: z.string(),
  image: z.string(),
  release: z.string().nullable(),
  lastSeenAt: isoInstant.nullable(),
});
export type OpsUpgradeWaitingWriter = z.infer<typeof opsUpgradeWaitingWriterSchema>;

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
  progress: opsUpgradeStepProgressSchema.nullable(),
  waitingOn: z.array(opsUpgradeWaitingWriterSchema),
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

/** One release of a previewed plan: the step ids it runs, by phase. */
export const opsUpgradePlannedReleaseSchema = z.object({
  release: z.string().nullable(),
  virtual: z.boolean(),
  schema: z.array(z.string()),
  blocking: z.array(z.string()),
  background: z.array(z.string()),
  operator: z.array(z.string()),
});

/** The plan narrowed to the target, or the reader's refusal; `code` is the reader's word, raw. */
export const opsUpgradePlanSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("planned"),
    fresh: z.boolean(),
    releases: z.array(opsUpgradePlannedReleaseSchema),
    notNeeded: z.array(z.string()),
  }),
  z.object({
    outcome: z.literal("refused"),
    code: z.string(),
    stopAt: z.string().nullable(),
    message: z.string(),
  }),
]);
export type OpsUpgradePlan = z.infer<typeof opsUpgradePlanSchema>;

/** One preflight row as the CLI prints it; `outcome` is verified, refused or unchecked. */
export const opsUpgradePreflightRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  outcome: z.string(),
  detail: z.string().nullable(),
  fix: z.string().nullable(),
  docsPath: z.string().nullable(),
});
export type OpsUpgradePreflightRow = z.infer<typeof opsUpgradePreflightRowSchema>;

export const opsUpgradePreviewSchema = z.object({
  installed: z.string().nullable(),
  plan: opsUpgradePlanSchema,
  preflight: z.array(opsUpgradePreflightRowSchema),
});
export type OpsUpgradePreview = z.infer<typeof opsUpgradePreviewSchema>;

export const opsUpgradePreviewInputSchema = z.object({ to: z.string().min(1) });
export type OpsUpgradePreviewInput = z.infer<typeof opsUpgradePreviewInputSchema>;

/** One ClickHouse target: its latest done version, steps not done and latest failure. */
export const opsUpgradeTargetSummarySchema = z.object({
  target: z.string(),
  version: z.string().nullable(),
  outstanding: z.number().int(),
  lastError: z.string().nullable(),
});
export type OpsUpgradeTargetSummary = z.infer<typeof opsUpgradeTargetSummarySchema>;

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

  /** `upgrade plan --to` with its preflight; a target newer than the image is refused. */
  .query("preview")
  .withInput(opsUpgradePreviewInputSchema)
  .withOutput(opsUpgradePreviewSchema)

  /** Each ClickHouse target the ledger records per-target rows for; empty when none. */
  .query("listTargets")
  .withInput(z.void())
  .withOutput(opsUpgradeTargetSummarySchema.array())

  /** Sets a failed step pending for the worker; `upgrade_step_not_failed` when it is not failed. */
  .mutation("retryStep")
  .withInput(opsUpgradeIdInputSchema)
  .withOutput(opsUpgradeStepDetailSchema)

  /**
   * The in-place system migrations, per migration: the status rollup plus the
   * tenants needing attention - held and parked. Finalized tenants are a
   * count, not a listing.
   */
  .query("listSystemMigrations")
  .withInput(z.void())
  .withOutput(opsMigrationOverviewSchema.array())

  /**
   * Which organizations are enrolled for which migrations, with the names an
   * operator recognizes. Carries `isSaaS`, so the page can say honestly that a
   * self-hosted installation has nothing to enroll.
   */
  .query("listMigrationEnrollments")
  .withInput(z.void())
  .withOutput(opsMigrationEnrollmentListingSchema)

  /**
   * The organization lookup behind the page's pickers: enroll, targeted run
   * and rollback all act on an organization found by name or exact id.
   */
  .query("searchMigrationOrganizations")
  .withInput(opsSearchMigrationOrganizationsInputSchema)
  .withOutput(opsMigrationOrganizationMatchSchema.array())

  /**
   * Enroll one organization for one registered migration, effective next
   * pass. Duplicates, unknown migrations/organizations, auto-admitting
   * migrations and self-hosted installs are each refused by name.
   */
  .mutation("enrollMigrationTenant")
  .withInput(opsEnrollMigrationTenantInputSchema)
  .withOutput(opsMigrationEnrolledSchema)

  /**
   * Enroll a sampled cohort in one action. Drawn from organizations not yet
   * enrolled, excluding enterprise plans and private-dataplane routes by
   * data rather than by any list in code; either exclusion is liftable per draw.
   */
  .mutation("enrollMigrationCohort")
  .withInput(opsEnrollMigrationCohortInputSchema)
  .withOutput(opsMigrationCohortResultSchema)

  /**
   * Withdraw an enrollment: later passes stop processing the organization for
   * that migration, and state already recorded stays exactly as it is. Undoing
   * it is the rollback's job.
   */
  .mutation("withdrawMigrationTenant")
  .withInput(opsMigrationTenantInputSchema)
  .withOutput(opsMigrationWithdrawnSchema)

  /**
   * Run one migration for one organization now, awaited: the operator asked
   * about one organization and gets the status it ended the run in.
   */
  .mutation("runSystemMigrationForOrganization")
  .withInput(opsRunSystemMigrationForOrganizationInputSchema)
  .withOutput(opsMigrationTargetedRunResultSchema)

  /**
   * Kick a pass now instead of waiting for the next worker boot.
   * Fire-and-forget: per-organization claims already keep two passes off the
   * same organization.
   */
  .mutation("runSystemMigrationPass")
  .withInput(z.void())
  .withOutput(opsMigrationPassStartedSchema)

  .mutation("assertSystemMigrationLegacyWritersDrained")
  .withInput(opsAssertLegacyWritersDrainedInputSchema)
  .withOutput(opsMigrationDrainAssertedSchema)

  /**
   * The operator rollback: pin a migrated or finalized organization back onto
   * its legacy path. An already rolled-back organization RETRIES, which is how
   * a rollback whose effect died halfway is finished.
   */
  .mutation("rollBackSystemMigrationTenant")
  .withInput(opsRollBackSystemMigrationTenantInputSchema)
  .withOutput(opsMigrationRolledBackSchema)
  .build();

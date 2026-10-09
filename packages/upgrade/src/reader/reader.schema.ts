import { z } from "zod";

/**
 * The reader's outputs (dev/docs/plans/upgrade-ui-2026-10-06.md sections 4 and 8). Kinds, modes
 * and statuses are plain strings: an older release's page reads rows a newer runner wrote, and an
 * unknown value is shown raw, never thrown on. The labels and tones are in `labels.ts`.
 */
export const installationStateSchema = z.enum([
  "unsupported",
  "needs-attention",
  "upgrading",
  "never-upgraded",
  "behind",
  "rolled-back",
  "finishing-in-background",
  "up-to-date",
]);
export type InstallationState = z.infer<typeof installationStateSchema>;

export const installationToneSchema = z.enum(["neutral", "info", "warning", "danger"]);
export type InstallationTone = z.infer<typeof installationToneSchema>;

export const installationReasonSchema = z.enum([
  "installed-below-floor",
  "image-below-ledger-floor",
  "failed-step",
  "failed-target",
  "run-in-progress",
  "no-upgrade-recorded",
  "image-newer",
  "blocking-steps-pending",
  "image-older",
  "background-pending",
  "current",
]);
export type InstallationReason = z.infer<typeof installationReasonSchema>;

/** How the installed release is known: a run the runner recorded, a seed's guess, or not at all. */
export const installedOriginSchema = z.enum(["recorded", "inferred", "none"]);
export type InstalledOrigin = z.infer<typeof installedOriginSchema>;

/** An ISO 8601 instant in UTC: what the wire carries, so no Date is minted on either side. */
const isoInstant = z.string();

const countsSchema = z.record(z.string(), z.number().int());

export const upgradeTargetViewSchema = z.object({
  target: z.string(),
  status: z.string(),
  version: z.string().nullable(),
  lastError: z.string().nullable(),
  updatedAt: isoInstant.nullable(),
});
export type UpgradeTargetView = z.infer<typeof upgradeTargetViewSchema>;

/**
 * A step's progress, read from its checkpoint report's agreed keys `done` and `total`
 * (STEP-PROGRESS, Alex 2026-10-09); a report without both reads as no progress.
 */
export const upgradeStepProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});
export type UpgradeStepProgress = z.infer<typeof upgradeStepProgressSchema>;

/** A live serving process whose image does not know a step that waits on old writers. */
export const upgradeWaitingWriterSchema = z.object({
  role: z.string(),
  image: z.string(),
  release: z.string().nullable(),
  lastSeenAt: isoInstant.nullable(),
});
export type UpgradeWaitingWriter = z.infer<typeof upgradeWaitingWriterSchema>;

/** A ledger step, or a step the image declares and the ledger has no row for (`recorded` false). */
export const upgradeStepViewSchema = z.object({
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
  report: z.record(z.string(), z.unknown()).nullable(),
  progress: upgradeStepProgressSchema.nullable(),
  waitingOn: z.array(upgradeWaitingWriterSchema),
  runId: z.string().nullable(),
  startedAt: isoInstant.nullable(),
  finishedAt: isoInstant.nullable(),
  updatedAt: isoInstant.nullable(),
});
export type UpgradeStepView = z.infer<typeof upgradeStepViewSchema>;

export const upgradeStepDetailSchema = z.object({
  ...upgradeStepViewSchema.shape,
  targets: z.array(upgradeTargetViewSchema),
});
export type UpgradeStepDetail = z.infer<typeof upgradeStepDetailSchema>;

export const upgradeReleaseSummarySchema = z.object({
  release: z.string().nullable(),
  installed: z.boolean(),
  image: z.boolean(),
  stepCount: z.number().int(),
  counts: countsSchema,
});
export type UpgradeReleaseSummary = z.infer<typeof upgradeReleaseSummarySchema>;

/** A run without its plan and report: the list rows. */
export const upgradeRunSummarySchema = z.object({
  id: z.string(),
  kind: z.string(),
  release: z.string().nullable(),
  floor: z.string().nullable(),
  startedAt: isoInstant,
  finishedAt: isoInstant.nullable(),
  outcome: z.string().nullable(),
});
export type UpgradeRunSummary = z.infer<typeof upgradeRunSummarySchema>;

/** One phase of a run's report (round 9, U2-PHASES); an unknown name or outcome reads raw. */
export const upgradeRunPhaseViewSchema = z.object({
  name: z.string(),
  release: z.string().nullable(),
  startedAt: isoInstant,
  finishedAt: isoInstant.nullable(),
  outcome: z.string(),
});
export type UpgradeRunPhaseView = z.infer<typeof upgradeRunPhaseViewSchema>;

export const upgradeRunDetailSchema = z.object({
  ...upgradeRunSummarySchema.shape,
  plan: z.record(z.string(), z.unknown()).nullable(),
  report: z.record(z.string(), z.unknown()).nullable(),
  phases: z.array(upgradeRunPhaseViewSchema),
  steps: z.array(upgradeStepViewSchema),
});
export type UpgradeRunDetail = z.infer<typeof upgradeRunDetailSchema>;

export const upgradeLeaseViewSchema = z.object({
  name: z.string().nullable(),
  owner: z.string().nullable(),
  image: z.string().nullable(),
  host: z.string().nullable(),
  heartbeatAt: isoInstant.nullable(),
  expiresAt: isoInstant.nullable(),
});
export type UpgradeLeaseView = z.infer<typeof upgradeLeaseViewSchema>;

export const upgradeStatusSchema = z.object({
  state: installationStateSchema,
  label: z.string(),
  tone: installationToneSchema,
  reason: installationReasonSchema,
  summary: z.string(),
  installed: z.string().nullable(),
  origin: installedOriginSchema,
  image: z.string(),
  floor: z.string().nullable(),
  ledgerFloor: z.string().nullable(),
  lease: upgradeLeaseViewSchema.nullable(),
  lastRun: upgradeRunSummarySchema.nullable(),
  counts: countsSchema,
  failedStepIds: z.array(z.string()),
  failedTargets: z.number().int(),
});
export type UpgradeStatus = z.infer<typeof upgradeStatusSchema>;

/** One page: `cursor` is null on the last page, and on every read that is not paged. */
export function upgradePageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({ items: z.array(item), cursor: z.string().nullable() });
}

export const upgradeStepPageSchema = upgradePageSchema(upgradeStepViewSchema);
export const upgradeReleasePageSchema = upgradePageSchema(upgradeReleaseSummarySchema);
export const upgradeRunPageSchema = upgradePageSchema(upgradeRunSummarySchema);
export type UpgradeStepPage = z.infer<typeof upgradeStepPageSchema>;
export type UpgradeReleasePage = z.infer<typeof upgradeReleasePageSchema>;
export type UpgradeRunPage = z.infer<typeof upgradeRunPageSchema>;

/** What the image declares: its release, and every step its manifest lists. */
export const upgradeImageStepSchema = z.object({
  id: z.string(),
  kind: z.string(),
  mode: z.string(),
  release: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  needsOldWritersGone: z.boolean().optional(),
});
export type UpgradeImageStep = z.infer<typeof upgradeImageStepSchema>;

export const upgradeImageSchema = z.object({
  release: z.string(),
  steps: z.array(upgradeImageStepSchema),
});
export type UpgradeImage = z.infer<typeof upgradeImageSchema>;

export const upgradeFloorSchema = z.object({
  release: z.string(),
  namedAt: z.string().optional(),
});
export type UpgradeFloor = z.infer<typeof upgradeFloorSchema>;

export const listStepsFilterSchema = z.object({
  release: z.string().nullable().optional(),
  mode: z.string().optional(),
  status: z.string().optional(),
});
export type ListStepsFilter = z.infer<typeof listStepsFilterSchema>;

export const listRunsInputSchema = z.object({
  cursor: z.string().nullable().optional(),
  limit: z.number().int().positive().optional(),
});
export type ListRunsInput = z.infer<typeof listRunsInputSchema>;

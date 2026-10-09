import { describeStepStatus } from "./labels.ts";
import type { LedgerRosterRow, LedgerStepRow } from "./reader.repository.ts";
import {
  type ListStepsFilter,
  type UpgradeImage,
  type UpgradeImageStep,
  type UpgradeStepProgress,
  type UpgradeStepView,
  type UpgradeWaitingWriter,
  upgradeStepProgressSchema,
} from "./reader.schema.ts";
import { compareReleasesNewestFirst } from "./release.ts";

/** The report's `done` of `total`, or null when the step's report does not carry both. */
export function progressOf({
  report,
}: {
  report: Record<string, unknown> | null;
}): UpgradeStepProgress | null {
  const parsed = upgradeStepProgressSchema.safeParse(report);
  return parsed.success ? parsed.data : null;
}

const SETTLED = new Set(["done", "not-needed"]);
const NO_STEPS: ReadonlySet<string> = new Set();

/**
 * The live serving processes an unsettled step waits on: those whose image does not declare it,
 * when the step needs old writers gone: declared so, or named in the image's code step lookup
 * (STEP-WAITINGON, WAITINGON-LOOKUP, Alex 2026-10-09).
 */
export function waitingOnOf({
  id,
  status,
  declared,
  roster,
  needsOldWritersGone = NO_STEPS,
}: {
  id: string;
  status: string;
  declared: UpgradeImageStep | undefined;
  roster: readonly LedgerRosterRow[];
  needsOldWritersGone?: ReadonlySet<string>;
}): UpgradeWaitingWriter[] {
  const needs = declared?.needsOldWritersGone || needsOldWritersGone.has(id);
  if (!needs || SETTLED.has(status)) return [];
  return roster
    .filter((entry) => !entry.steps.includes(id))
    .map((entry) => ({
      role: entry.role,
      image: entry.image,
      release: entry.release,
      lastSeenAt: entry.heartbeat_at,
    }));
}

function viewRecorded({
  row,
  declared,
  roster,
  needsOldWritersGone,
}: {
  row: LedgerStepRow;
  declared: UpgradeImageStep | undefined;
  roster: readonly LedgerRosterRow[];
  needsOldWritersGone?: ReadonlySet<string>;
}): UpgradeStepView {
  return {
    id: row.id,
    kind: row.kind,
    release: row.release,
    mode: row.mode,
    status: row.status,
    statusLabel: describeStepStatus({ status: row.status }),
    owner: row.owner ?? declared?.owner ?? null,
    description: row.description ?? declared?.description ?? null,
    finishBy: row.finish_by ?? declared?.finishBy ?? null,
    recorded: true,
    inferred: row.inferred,
    attempt: row.attempt,
    lastError: row.last_error,
    report: row.report,
    progress: progressOf({ report: row.report }),
    waitingOn: waitingOnOf({
      id: row.id,
      status: row.status,
      declared,
      roster,
      needsOldWritersGone,
    }),
    runId: row.run_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

function viewDeclared({
  step,
  imageRelease,
  roster,
  needsOldWritersGone,
}: {
  step: UpgradeImageStep;
  imageRelease: string;
  roster: readonly LedgerRosterRow[];
  needsOldWritersGone?: ReadonlySet<string>;
}): UpgradeStepView {
  return {
    id: step.id,
    kind: step.kind,
    release: step.release ?? imageRelease,
    mode: step.mode,
    status: "pending",
    statusLabel: describeStepStatus({ status: "pending" }),
    owner: step.owner ?? null,
    description: step.description ?? null,
    finishBy: step.finishBy ?? null,
    recorded: false,
    inferred: false,
    attempt: 0,
    lastError: null,
    report: null,
    progress: null,
    waitingOn: waitingOnOf({
      id: step.id,
      status: "pending",
      declared: step,
      roster,
      needsOldWritersGone,
    }),
    runId: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: null,
  };
}

/** Ledger rows, then every step the image declares that the ledger has no row for yet. */
export function mergeSteps({
  rows,
  image,
  roster,
  needsOldWritersGone,
}: {
  rows: readonly LedgerStepRow[];
  image: UpgradeImage;
  roster: readonly LedgerRosterRow[];
  needsOldWritersGone?: ReadonlySet<string>;
}): UpgradeStepView[] {
  const declaredById = new Map(image.steps.map((step) => [step.id, step]));
  const recorded = new Set(rows.map((row) => row.id));
  const views = [
    ...rows.map((row) =>
      viewRecorded({ row, declared: declaredById.get(row.id), roster, needsOldWritersGone }),
    ),
    ...image.steps
      .filter((step) => !recorded.has(step.id))
      .map((step) =>
        viewDeclared({ step, imageRelease: image.release, roster, needsOldWritersGone }),
      ),
  ];
  return views.toSorted((left, right) => {
    const byRelease = compareReleasesNewestFirst({ left: left.release, right: right.release });
    return byRelease === 0 ? left.id.localeCompare(right.id, "en") : byRelease;
  });
}

export function filterSteps({
  steps,
  filter,
}: {
  steps: readonly UpgradeStepView[];
  filter: ListStepsFilter;
}): UpgradeStepView[] {
  return steps.filter(
    (step) =>
      (filter.release === undefined || step.release === filter.release) &&
      (filter.mode === undefined || step.mode === filter.mode) &&
      (filter.status === undefined || step.status === filter.status),
  );
}

export { viewRecorded as viewRecordedStep, viewDeclared as viewDeclaredStep };

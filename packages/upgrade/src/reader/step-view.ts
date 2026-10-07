import { describeStepStatus } from "./labels.ts";
import type { LedgerStepRow } from "./reader.repository.ts";
import type {
  ListStepsFilter,
  UpgradeImage,
  UpgradeImageStep,
  UpgradeStepView,
} from "./reader.schema.ts";
import { compareReleasesNewestFirst } from "./release.ts";

function viewRecorded({
  row,
  declared,
}: {
  row: LedgerStepRow;
  declared: UpgradeImageStep | undefined;
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
    recorded: true,
    inferred: row.inferred,
    attempt: row.attempt,
    lastError: row.last_error,
    report: row.report,
    runId: row.run_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

function viewDeclared({
  step,
  imageRelease,
}: {
  step: UpgradeImageStep;
  imageRelease: string;
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
    recorded: false,
    inferred: false,
    attempt: 0,
    lastError: null,
    report: null,
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
}: {
  rows: readonly LedgerStepRow[];
  image: UpgradeImage;
}): UpgradeStepView[] {
  const declaredById = new Map(image.steps.map((step) => [step.id, step]));
  const recorded = new Set(rows.map((row) => row.id));
  const views = [
    ...rows.map((row) => viewRecorded({ row, declared: declaredById.get(row.id) })),
    ...image.steps
      .filter((step) => !recorded.has(step.id))
      .map((step) => viewDeclared({ step, imageRelease: image.release })),
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

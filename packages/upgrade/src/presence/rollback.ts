import type { UpgradePresence, UpgradeRun, UpgradeStep } from "../ledger.ts";
import { compareReleases } from "../manifest/manifest.ts";

export type RollbackLedgerStep = Pick<UpgradeStep, "id" | "mode" | "status" | "release">;
export type RollbackLedgerRun = Pick<UpgradeRun, "id" | "kind" | "outcome" | "finishedAt">;
export type RollbackPresence = Pick<
  UpgradePresence,
  "processId" | "image" | "release" | "steps" | "startedAt"
>;

/** One older image seen serving after the last run, and the done steps it does not declare. */
export type RollbackSighting = Readonly<{
  row: RollbackPresence;
  runId: string;
  stepIds: string[];
}>;

/** The latest succeeded upgrade run that finished, by the database clock. */
function lastFinishedUpgrade({ runs }: { runs: readonly RollbackLedgerRun[] }) {
  return runs
    .filter((run) => run.kind === "upgrade" && run.outcome === "succeeded" && run.finishedAt)
    .toSorted(
      (left, right) => (right.finishedAt?.getTime() ?? 0) - (left.finishedAt?.getTime() ?? 0),
    )[0];
}

/**
 * Whether a step is newer than the image a row names: a release build lacks a later release's
 * steps and every unreleased one; a `git-<sha>` build only the unreleased ones. A step retired
 * below the floor is never newer, so it is never reopened.
 */
function newerThanImage({ step, row }: { step: RollbackLedgerStep; row: RollbackPresence }) {
  if (step.release === null) return true;
  return row.release !== null && compareReleases({ left: step.release, right: row.release }) > 0;
}

/**
 * Round 9 (S3-ROLLBACK): a live row that started after the last finished upgrade run and does not
 * declare a done background step newer than its image is a rollback; those steps reopen. Pure.
 */
export function detectRollbacks({
  runs,
  steps,
  live,
}: {
  runs: readonly RollbackLedgerRun[];
  steps: readonly RollbackLedgerStep[];
  live: readonly RollbackPresence[];
}): RollbackSighting[] {
  const last = lastFinishedUpgrade({ runs });
  if (!last?.finishedAt) return [];
  const finishedAt = last.finishedAt.getTime();
  const done = steps.filter((step) => step.mode === "background" && step.status === "done");
  return live.flatMap((row) => {
    if (row.startedAt.getTime() <= finishedAt) return [];
    const declared = new Set(row.steps);
    const stepIds = done
      .filter((step) => !declared.has(step.id) && newerThanImage({ step, row }))
      .map((step) => step.id);
    return stepIds.length > 0 ? [{ row, runId: last.id, stepIds }] : [];
  });
}

/** What the ledger is told, so the page says why a done step is waiting again. */
export function rollbackReason({ sighting }: { sighting: RollbackSighting }): string {
  const { row, runId } = sighting;
  return `reopened: image ${row.image} (${row.processId}) served after upgrade run ${runId}`;
}

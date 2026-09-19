/**
 * What the Trace Explorer needs of a run beyond the REST family: the runs it
 * registered for its `eval` chips resolved against the project, and a run's
 * counters in the shape its progress bar reads.
 *
 * The resolution is deliberately lenient. A run id the client sends is a
 * claim; a claim about a run of another project, or a deleted one, is dropped
 * rather than refused, because the read carrying it is the list the user is
 * looking at and a refusal there would blank the table for a chip that only
 * has to match nothing.
 *
 * @see ../../traces/filter-to-clickhouse/instant-eval-field.ts
 * @see ../../../../../specs/traces-v2/instant-eval-search.feature
 */

import type { ResolvedInstantEvalRun } from "~/server/app-layer/traces/filter-to-clickhouse/instant-eval-field";
import type { InstantEvalRunReference } from "~/server/app-layer/traces/query-language/instantEvalChips";
import type { InstantEvalRunProjectedStatus } from "~/server/event-sourcing/pipelines/instant-eval-processing/projections/instantEvalRun.stateProjection";
import type {
  InstantEvalRunRepository,
  InstantEvalRunRow,
} from "./instant-eval-run.repository";

/**
 * How far past its last write a run's judgements may still land, and how far
 * before its acceptance a judgement could have been written. Both cover clock
 * skew between the service that accepted the run and the worker that judged
 * it; neither is a window the partition prune cares about at day granularity.
 */
const WRITE_SKEW_MS = 60 * 60 * 1000;

/** The runs the client registered, as the filter compiler reads them. */
export async function resolveInstantEvalRunsForExplorer({
  runs,
  projectId,
  evalRuns,
  now = Date.now(),
}: {
  runs: Pick<InstantEvalRunRepository, "findById">;
  projectId: string;
  evalRuns: Readonly<Record<string, InstantEvalRunReference>>;
  now?: number;
}): Promise<ResolvedInstantEvalRun[]> {
  const references = Object.values(evalRuns);
  const rows = await Promise.all(
    references.map((reference) =>
      runs.findById({ projectId, runId: reference.runId }),
    ),
  );
  const resolved: ResolvedInstantEvalRun[] = [];
  references.forEach((reference, index) => {
    const row = rows[index];
    if (!row) return;
    resolved.push({
      question: reference.question,
      target: reference.target,
      runId: row.id,
      writtenFrom: row.createdAt.getTime() - WRITE_SKEW_MS,
      writtenUntil: (row.finishedAt?.getTime() ?? now) + WRITE_SKEW_MS,
    });
  });
  return resolved;
}

/** Where a run is in its life, lowercase, as the Explorer reads it. */
export const INSTANT_EVAL_EXPLORER_STATUSES = [
  "queued",
  "planning",
  "running",
  "finished",
  "failed",
  "cancelled",
] as const;

export type InstantEvalExplorerStatus =
  (typeof INSTANT_EVAL_EXPLORER_STATUSES)[number];

const EXPLORER_STATUS = {
  QUEUED: "queued",
  PLANNING: "planning",
  RUNNING: "running",
  FINISHED: "finished",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const satisfies Record<
  InstantEvalRunProjectedStatus,
  InstantEvalExplorerStatus
>;

/** A run's counters, which is all the progress bar and the chip read. */
export interface InstantEvalExplorerRun {
  id: string;
  status: InstantEvalExplorerStatus;
  total: number | null;
  progress: number;
  matched: number | null;
  failed: number;
  skipped: number;
  /** The code of the failure that ended the run, when one did. */
  error: string | null;
  priceUsd: number;
}

export function toInstantEvalExplorerRun(
  row: InstantEvalRunRow,
): InstantEvalExplorerRun {
  return {
    id: row.id,
    status: EXPLORER_STATUS[row.status],
    total: row.total,
    progress: row.progress,
    matched: row.matched,
    failed: row.failed,
    skipped: row.skipped,
    error: row.error,
    priceUsd: row.priceUsd,
  };
}

/** Whether the run is still judging, so the client keeps polling. */
export function isInstantEvalRunActive(
  status: InstantEvalExplorerStatus,
): boolean {
  return status === "queued" || status === "planning" || status === "running";
}

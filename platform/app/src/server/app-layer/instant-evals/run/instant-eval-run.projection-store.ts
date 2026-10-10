/**
 * The projection's half of the run row.
 *
 * The state projection folds the run's events into counters and hands them
 * here to be stored; the store reads the row the service wrote, lays the
 * counters over it, and writes the whole row back through the repository. It
 * never writes the definition, and a run somebody deleted has no row to lay
 * counters over, so its write is a no-op and the run stops rather than
 * reappearing.
 *
 * `load` answers null when the row has no checkpoint yet, which is the state
 * every accepted run starts in: the service wrote the definition and no event
 * has been folded, so the fold starts from `init()` rather than from counters
 * that were never applied to anything.
 *
 * @see ./instant-eval-run.repository.ts
 * @see ../../../event-sourcing/pipelines/instant-eval-processing/projections/instantEvalRun.stateProjection.ts
 */

import { createLogger } from "@langwatch/observability";

import type { InstantEvalRunProjectionState } from "~/server/event-sourcing/pipelines/instant-eval-processing/projections/instantEvalRun.stateProjection";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import type {
  ClickHouseInstantEvalRunRepository,
  InstantEvalRunRow,
} from "./instant-eval-run.repository";

const logger = createLogger("langwatch:instant-evals:run-projection-store");

/** What a row with no recorded version is read as. */
export const INITIAL_PROJECTION_VERSION = "2026-09-18";

export class ClickHouseInstantEvalRunProjectionStore
  implements StateProjectionStore<InstantEvalRunProjectionState>
{
  constructor(private readonly runs: ClickHouseInstantEvalRunRepository) {}

  async load(
    projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjection<InstantEvalRunProjectionState> | null> {
    const row = await this.runs.findById({
      projectId: String(context.tenantId),
      runId: projectionKey,
    });
    if (!row || row.lastEventId === null || row.acceptedAt === null) {
      return null;
    }
    return {
      state: stateFromRow(row),
      cursor: { acceptedAt: row.acceptedAt, eventId: row.lastEventId },
      occurredAt: row.occurredAt ?? row.createdAt.getTime(),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      version: row.projectionVersion ?? INITIAL_PROJECTION_VERSION,
    };
  }

  async store(
    projection: StoredProjection<InstantEvalRunProjectionState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const runId = context.key ?? context.aggregateId;
    // The run id rides with the project id, so a key from another tenant's
    // stream could never read, or overwrite, this project's row.
    const current = await this.runs.findById({ projectId, runId });
    if (!current) {
      logger.warn(
        { projectId, runId },
        "Instant Eval run row is gone; its counters are not written",
      );
      return;
    }
    const { state } = projection;
    await this.runs.write({
      ...current,
      status: state.status,
      total: state.total,
      progress: state.progress,
      matched: state.matched,
      matchedByQuestion: state.matchedByQuestion,
      failed: state.failed,
      skipped: state.skipped,
      tokens: state.tokens,
      costUsd: state.costUsd,
      priceUsd: state.priceUsd,
      error: state.error,
      startedAt:
        state.startedAtMs === null ? null : new Date(state.startedAtMs),
      finishedAt:
        state.finishedAtMs === null ? null : new Date(state.finishedAtMs),
      // The envelope's timestamps, not the clock: a replay has to reproduce
      // the same row rather than stamp it with whenever it was replayed. The
      // version column is the one exception, and the repository owns it.
      updatedAt: new Date(projection.updatedAt),
      occurredAt: projection.occurredAt,
      acceptedAt: projection.cursor.acceptedAt,
      lastEventId: projection.cursor.eventId,
      projectionVersion: projection.version,
    });
  }
}

/** The counters a row carries, read back as the projection's state. */
export function stateFromRow(
  row: InstantEvalRunRow,
): InstantEvalRunProjectionState {
  return {
    status: row.status,
    total: row.total,
    progress: row.progress,
    matched: row.matched,
    matchedByQuestion: row.matchedByQuestion,
    failed: row.failed,
    skipped: row.skipped,
    tokens: row.tokens,
    costUsd: row.costUsd,
    priceUsd: row.priceUsd,
    error: row.error,
    startedAtMs: row.startedAt?.getTime() ?? null,
    finishedAtMs: row.finishedAt?.getTime() ?? null,
  };
}

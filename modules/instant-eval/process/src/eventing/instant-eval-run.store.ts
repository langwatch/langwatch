/**
 * The projection's half of the run row: counters laid over what the service
 * wrote, never its definition, and never over a run that is gone.
 * @see ./instant-eval-run.projection.ts
 */

import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";

import type {
  InstantEvalRunRepository,
  InstantEvalRunRow,
} from "../repositories/instant-eval-run.repository.ts";
import type { InstantEvalRunProjectionState } from "./instant-eval-run.projection.ts";

const logger = createLogger("langwatch:instant-eval:run-projection-store");

/** What a row with no recorded version is read as. */
export const INITIAL_INSTANT_EVAL_PROJECTION_VERSION = "2026-09-18";

/** The counters a row carries, read back as the projection's state. */
export function instantEvalStateFromRow(row: InstantEvalRunRow): InstantEvalRunProjectionState {
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
    startedAtMs: row.startedAt?.epochMilliseconds ?? null,
    finishedAtMs: row.finishedAt?.epochMilliseconds ?? null,
  };
}

export class InstantEvalRunProjectionStore implements StateProjectionStore<InstantEvalRunProjectionState> {
  private constructor(private readonly runs: InstantEvalRunRepository) {}

  static create({ runs }: { runs: InstantEvalRunRepository }): InstantEvalRunProjectionStore {
    return new InstantEvalRunProjectionStore(runs);
  }

  /**
   * Null while the row has no checkpoint, which is where every accepted run
   * starts: the service wrote the definition and nothing has been folded, so
   * the fold starts from `init()` rather than from counters never applied.
   */
  async get(
    projectionKey: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<InstantEvalRunProjectionState>> {
    const row = await this.runs.findById({
      projectId: String(context.tenantId),
      runId: projectionKey,
    });
    if (!row || row.lastEventId === null || row.acceptedAt === null) return { kind: "empty" };

    return {
      kind: "folded",
      projection: {
        state: instantEvalStateFromRow(row),
        cursor: { acceptedAt: row.acceptedAt, eventId: row.lastEventId },
        occurredAt: row.occurredAt ?? row.createdAt.epochMilliseconds,
        createdAt: row.createdAt.epochMilliseconds,
        updatedAt: row.updatedAt.epochMilliseconds,
        version: row.projectionVersion ?? INITIAL_INSTANT_EVAL_PROJECTION_VERSION,
      },
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
        state.startedAtMs === null
          ? null
          : Temporal.Instant.fromEpochMilliseconds(state.startedAtMs),
      finishedAt:
        state.finishedAtMs === null
          ? null
          : Temporal.Instant.fromEpochMilliseconds(state.finishedAtMs),
      // The envelope's timestamps, not the clock: a replay reproduces the same
      // row rather than stamping it with whenever it was replayed.
      updatedAt: Temporal.Instant.fromEpochMilliseconds(projection.updatedAt),
      occurredAt: projection.occurredAt,
      acceptedAt: projection.cursor.acceptedAt,
      lastEventId: projection.cursor.eventId,
      projectionVersion: projection.version,
    });
  }
}

// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import { createLogger } from "@langwatch/observability";
import { randomUUID } from "crypto";
import { env } from "~/env.mjs";
import {
  createReplayRuntime,
  type ReplayRuntime,
} from "~/server/event-sourcing/replay/replayPreset";
import type { ReplayProgress } from "~/server/event-sourcing/replay/types";
import type {
  ReplayHistoryEntry,
  ReplayRepository,
  ReplayStatus,
} from "./repositories/replay.repository";

const logger = createLogger("langwatch:ops:replay-service");

const REPLAY_LOCK_TTL_SECONDS = 3600;

/** How often the progress callback re-polls the cancel flag between events. */
const CANCEL_CHECK_INTERVAL_MS = 3000;

/**
 * How often the running replay re-extends its lock on a standalone heartbeat
 * timer. Running independently of progress/batch callbacks keeps the lock
 * alive even when a single batch phase (a huge tenant's drain wait, a slow
 * ClickHouse load) emits nothing for longer than REPLAY_LOCK_TTL_SECONDS,
 * whose expiry used to silently stop status updates mid-run.
 */
export const LOCK_REFRESH_INTERVAL_MS = 60_000;

class ReplayCancelledError extends Error {
  constructor() {
    super("Replay cancelled");
  }
}

/** Mutable, shared between the heartbeat and the progress callback. */
type CancellationState = { cancelled: boolean };

type ProjectionSelection = {
  selectedProjections: ReplayRuntime["projections"];
  selectedMapProjections: ReplayRuntime["mapProjections"];
  selectedStateProjections: ReplayRuntime["stateProjections"];
};

function selectProjections({
  runtime,
  projectionNames,
}: {
  runtime: ReplayRuntime;
  projectionNames: string[];
}): ProjectionSelection {
  return {
    selectedProjections: runtime.projections.filter((p) =>
      projectionNames.includes(p.projectionName),
    ),
    selectedMapProjections: runtime.mapProjections.filter((p) =>
      projectionNames.includes(p.projectionName),
    ),
    selectedStateProjections: runtime.stateProjections.filter((p) =>
      projectionNames.includes(p.projectionName),
    ),
  };
}

function hasNoSelectedProjections(selection: ProjectionSelection): boolean {
  return (
    selection.selectedProjections.length === 0 &&
    selection.selectedMapProjections.length === 0 &&
    selection.selectedStateProjections.length === 0
  );
}

/**
 * Under the replay lock and before discovery: drop the markers a resume
 * would consult, so no aggregate is skipped as already done. See the
 * fullRebuild doc on startReplay for when this is required. A failure here
 * aborts the run rather than replaying against stale markers, which is the
 * silent-skip this flag exists to prevent.
 */
async function clearReplayMarkersForFullRebuild({
  runtime,
  runId,
  selection,
}: {
  runtime: ReplayRuntime;
  runId: string;
  selection: ProjectionSelection;
}): Promise<void> {
  for (const projection of [
    ...selection.selectedProjections,
    ...selection.selectedMapProjections,
    ...selection.selectedStateProjections,
  ]) {
    const projectionName = projection.projectionName;
    const cleared = await runtime.service.checkPreviousRun(projectionName);
    await runtime.service.cleanup(projectionName);
    logger.info(
      {
        runId,
        projectionName,
        completedMarkersCleared: cleared.completedCount,
        inFlightMarkersCleared: cleared.markerCount,
      },
      "Cleared replay markers for full rebuild",
    );
  }
}

export class ReplayService {
  constructor(readonly repo: ReplayRepository) {}

  async getStatus(): Promise<ReplayStatus> {
    return this.repo.getStatus();
  }

  async getHistory(): Promise<ReplayHistoryEntry[]> {
    return this.repo.getHistory();
  }

  async findHistoryEntry(params: {
    runId: string;
  }): Promise<ReplayHistoryEntry | null> {
    const history = await this.repo.getHistory();
    return history.find((entry) => entry.runId === params.runId) ?? null;
  }

  async startReplay(params: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
    aggregateIds?: string[];
    /**
     * Rebuild from scratch instead of resuming: clear the selected
     * projections' replay markers (completed set and in-flight cutoffs) under
     * the replay lock, before discovery, so every discovered aggregate is
     * replayed rather than skipped as already done.
     *
     * Required whenever the target tables no longer hold the rows those
     * markers vouch for: tables truncated by hand, or swapped empty by a
     * migration. Markers from an earlier aborted run survive on purpose so a
     * plain re-run resumes where it stopped; against emptied tables that same
     * behaviour drops the skipped aggregates' history with a successful-looking
     * run and no error.
     *
     * Only safe when the target tables are empty for the replayed scope: map
     * projections append increments, so replaying an aggregate whose rows are
     * still present double counts. Leave unset to resume a partially failed
     * run whose written rows are still in place.
     */
    fullRebuild?: boolean;
    description: string;
    userName: string;
  }): Promise<{ runId: string }> {
    const runId = randomUUID();

    const acquired = await this.repo.acquireLock({
      runId,
      ttlSeconds: REPLAY_LOCK_TTL_SECONDS,
    });
    if (!acquired) {
      throw new Error("A replay is already running");
    }

    await this.repo.clearCancelFlag();

    const initialStatus: ReplayStatus = {
      state: "running",
      runId,
      startedAt: new Date().toISOString(),
      completedAt: null,
      projectionNames: params.projectionNames,
      since: params.since,
      tenantIds: params.tenantIds,
      currentProjection: null,
      currentPhase: null,
      aggregatesProcessed: 0,
      aggregatesTotal: 0,
      eventsProcessed: 0,
      error: null,
      description: params.description,
      userName: params.userName,
    };
    await this.repo.writeStatus({ status: initialStatus });

    this.executeReplay({ runId, ...params }).then(
      () => {},
      (err) => {
        logger.error(
          { error: err, runId },
          "Unexpected replay orchestration error",
        );
      },
    );

    return { runId };
  }

  async cancelReplay(): Promise<{ cancelled: boolean }> {
    const status = await this.repo.getStatus();
    if (status.state !== "running") {
      return { cancelled: false };
    }
    // TTL matches the lock TTL so the flag cannot expire between polls
    // during a long callback-silent batch phase — the heartbeat checks it
    // every LOCK_REFRESH_INTERVAL_MS.
    await this.repo.setCancelled({ ttlSeconds: REPLAY_LOCK_TTL_SECONDS });
    return { cancelled: true };
  }

  private async executeReplay(params: {
    runId: string;
    projectionNames: string[];
    since: string;
    tenantIds: string[];
    aggregateIds?: string[];
    fullRebuild?: boolean;
    description: string;
    userName: string;
  }): Promise<void> {
    const runtime = await this.resolveReplayRuntime({ runId: params.runId });
    if (!runtime) return;

    try {
      const selection = selectProjections({
        runtime,
        projectionNames: params.projectionNames,
      });
      if (hasNoSelectedProjections(selection)) {
        await this.finalizeWithError({
          runId: params.runId,
          errorMessage: "No matching projections found",
        });
        return;
      }

      const cancelledBeforeStart = await this.repo.isCancelled();
      if (cancelledBeforeStart) {
        await this.finalizeCancelled({
          runId: params.runId,
          historyCtx: params,
        });
        return;
      }

      if (params.fullRebuild) {
        await clearReplayMarkersForFullRebuild({
          runtime,
          runId: params.runId,
          selection,
        });
      }

      await this.runSelectedReplay({ runtime, selection, params });
    } catch (err) {
      await this.finalizeAfterFailure({ err, params });
    } finally {
      await runtime.close();
      await this.repo.releaseLock({ runId: params.runId });
    }
  }

  /** Resolves the replay runtime, finalizing the run with an error and returning `null` on failure. */
  private async resolveReplayRuntime({
    runId,
  }: {
    runId: string;
  }): Promise<ReplayRuntime | null> {
    const redisUrl = env.REDIS_URL;
    if (!redisUrl) {
      await this.finalizeWithError({
        runId,
        errorMessage: "REDIS_URL is not configured",
      });
      return null;
    }
    try {
      return createReplayRuntime({ redisUrl });
    } catch (err) {
      await this.finalizeWithError({
        runId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * If another run has taken the lock over, it owns the status row now —
   * finalizing here would overwrite the successor's "running" status with
   * this stale run's cancelled/failed state. A null holder (expired, no
   * successor) still finalizes so the run's end state stays observable.
   */
  private async finalizeAfterFailure({
    err,
    params,
  }: {
    err: unknown;
    params: {
      runId: string;
      projectionNames: string[];
      since: string;
      tenantIds: string[];
      description: string;
      userName: string;
    };
  }): Promise<void> {
    const lockHolder = await this.repo.getLockHolder();
    if (lockHolder !== null && lockHolder !== params.runId) {
      logger.warn(
        { runId: params.runId, lockHolder },
        "Skipping replay finalization: lock now held by another run",
      );
    } else if (err instanceof ReplayCancelledError) {
      await this.finalizeCancelled({
        runId: params.runId,
        historyCtx: params,
      });
    } else {
      await this.finalizeWithError({
        runId: params.runId,
        errorMessage: err instanceof Error ? err.message : String(err),
        historyCtx: params,
      });
    }
  }

  /**
   * Runs the replay call against the selected projections under a refresh
   * heartbeat, then finalizes success/failure. Mirrors the executeReplay
   * catch-path guard: only a takeover by ANOTHER run skips finalization — a
   * null holder (lock expired, no successor) still finalizes so a completed
   * run is never left stuck in "running".
   */
  private async runSelectedReplay({
    runtime,
    selection,
    params,
  }: {
    runtime: ReplayRuntime;
    selection: ProjectionSelection;
    params: {
      runId: string;
      projectionNames: string[];
      since: string;
      tenantIds: string[];
      aggregateIds?: string[];
      description: string;
      userName: string;
    };
  }): Promise<void> {
    const { heartbeat, state: cancellation } = this.startCancellationHeartbeat({
      runId: params.runId,
    });

    let result;
    try {
      const replayConfig = {
        projections: selection.selectedProjections,
        mapProjections: selection.selectedMapProjections,
        stateProjections: selection.selectedStateProjections,
        tenantIds: params.tenantIds,
        since: params.since,
        aggregateIds: params.aggregateIds,
      };
      const replayCallbacks = this.buildReplayCallbacks({
        runId: params.runId,
        cancellation,
      });
      result =
        selection.selectedStateProjections.length > 0
          ? await runtime.service.replay(replayConfig, replayCallbacks)
          : await runtime.service.replayOptimized(
              replayConfig,
              replayCallbacks,
            );
    } finally {
      clearInterval(heartbeat);
    }

    const lockHolder = await this.repo.getLockHolder();
    if (lockHolder !== null && lockHolder !== params.runId) return;

    if (result.batchErrors > 0) {
      await this.finalizeWithError({
        runId: params.runId,
        errorMessage: result.firstError ?? "Unknown batch error",
        historyCtx: params,
      });
    } else {
      await this.finalizeSuccess({ params, result });
    }
  }

  /**
   * Heartbeat: refresh the lock on a standalone timer for the duration of
   * the runtime call, so the lock survives runs longer than its TTL even
   * when a single batch phase emits no callbacks for that long. Also polls
   * the cancel flag, so a cancel request is picked up even during batch
   * phases that emit no progress callbacks for a long time.
   */
  private startCancellationHeartbeat({ runId }: { runId: string }): {
    heartbeat: NodeJS.Timeout;
    state: CancellationState;
  } {
    const state: CancellationState = { cancelled: false };

    const heartbeatTick = () => {
      this.repo
        .refreshLock({ runId, ttlSeconds: REPLAY_LOCK_TTL_SECONDS })
        .then((stillHeld) => {
          if (!stillHeld) {
            // Lock expired and another run took over — abort this stale
            // run via the existing cancellation path so it stops touching
            // the shared projection pause keys. Warn once and stop the
            // heartbeat: the lock is confirmed gone, so there is nothing
            // left to refresh and no point re-warning every interval.
            logger.warn(
              { runId },
              "Replay lock lost to another run; aborting stale replay",
            );
            state.cancelled = true;
            clearInterval(heartbeat);
          }
        })
        .catch((err) => {
          logger.warn({ error: err }, "Failed to refresh replay lock");
        });

      this.repo
        .isCancelled()
        .then((cancelled) => {
          if (cancelled) state.cancelled = true;
        })
        .catch((err) => {
          logger.warn({ error: err }, "Failed to poll replay cancel flag");
        });
    };

    const heartbeat = setInterval(heartbeatTick, LOCK_REFRESH_INTERVAL_MS);
    heartbeat.unref();
    return { heartbeat, state };
  }

  /** Builds the replay-service progress callback, throwing to abort on cancellation. */
  private buildReplayCallbacks({
    runId,
    cancellation,
  }: {
    runId: string;
    cancellation: CancellationState;
  }): { onProgress: (progress: ReplayProgress) => void } {
    let lastCancelCheck = Date.now();
    return {
      onProgress: (progress: ReplayProgress) => {
        this.updateProgress({ runId, progress }).catch((err) => {
          logger.warn({ error: err }, "Failed to update replay progress");
        });

        const now = Date.now();
        if (now - lastCancelCheck > CANCEL_CHECK_INTERVAL_MS) {
          lastCancelCheck = now;
          this.repo
            .isCancelled()
            .then((cancelled) => {
              if (cancelled) cancellation.cancelled = true;
            })
            .catch(() => {});
        }

        if (cancellation.cancelled) {
          throw new ReplayCancelledError();
        }
      },
    };
  }

  /** Writes the completed status + history entry for a successful replay run. */
  private async finalizeSuccess({
    params,
    result,
  }: {
    params: {
      runId: string;
      projectionNames: string[];
      since: string;
      tenantIds: string[];
      description: string;
      userName: string;
    };
    result: { aggregatesReplayed: number; totalEvents: number };
  }): Promise<void> {
    const completedAt = new Date().toISOString();
    const status = await this.repo.getStatus();
    await this.repo.writeStatus({
      status: {
        ...status,
        state: "completed",
        completedAt,
        aggregatesProcessed: result.aggregatesReplayed,
        eventsProcessed: result.totalEvents,
      },
    });
    await this.repo.pushToHistory({
      entry: {
        runId: params.runId,
        projectionNames: params.projectionNames,
        since: params.since,
        tenantIds: params.tenantIds,
        description: params.description,
        startedAt: status.startedAt ?? completedAt,
        completedAt,
        state: "completed",
        userName: params.userName,
        aggregatesProcessed: result.aggregatesReplayed,
        eventsProcessed: result.totalEvents,
      },
    });
  }

  private async updateProgress(params: {
    runId: string;
    progress: ReplayProgress;
  }): Promise<void> {
    const lockHolder = await this.repo.getLockHolder();
    if (lockHolder !== params.runId) return;

    const current = await this.repo.getStatus();
    if (current.state !== "running" || current.runId !== params.runId) return;

    await this.repo.writeStatus({
      status: {
        ...current,
        currentProjection: params.progress.currentProjectionName,
        currentPhase: params.progress.batchPhase,
        aggregatesProcessed: params.progress.aggregatesCompleted,
        aggregatesTotal: params.progress.totalAggregates,
        eventsProcessed: params.progress.totalEventsReplayed,
      },
    });
  }

  private async finalizeWithError(params: {
    runId: string;
    errorMessage: string;
    historyCtx?: {
      projectionNames: string[];
      since: string;
      tenantIds: string[];
      description: string;
      userName: string;
    };
  }): Promise<void> {
    logger.error(
      { runId: params.runId, error: params.errorMessage },
      "Replay failed",
    );
    const current = await this.repo.getStatus();
    const completedAt = new Date().toISOString();
    await this.repo.writeStatus({
      status: {
        ...current,
        state: "failed",
        completedAt,
        error: params.errorMessage,
      },
    });
    if (params.historyCtx) {
      await this.repo.pushToHistory({
        entry: {
          runId: params.runId,
          ...params.historyCtx,
          startedAt: current.startedAt ?? completedAt,
          completedAt,
          state: "failed",
          aggregatesProcessed: current.aggregatesProcessed,
          eventsProcessed: current.eventsProcessed,
          error: params.errorMessage,
        },
      });
    }
    await this.repo.releaseLock({ runId: params.runId });
  }

  private async finalizeCancelled(params: {
    runId: string;
    historyCtx?: {
      projectionNames: string[];
      since: string;
      tenantIds: string[];
      description: string;
      userName: string;
    };
  }): Promise<void> {
    logger.info({ runId: params.runId }, "Replay cancelled");
    const current = await this.repo.getStatus();
    const completedAt = new Date().toISOString();
    await this.repo.writeStatus({
      status: {
        ...current,
        state: "cancelled",
        completedAt,
      },
    });
    if (params.historyCtx) {
      await this.repo.pushToHistory({
        entry: {
          runId: params.runId,
          ...params.historyCtx,
          startedAt: current.startedAt ?? completedAt,
          completedAt,
          state: "cancelled",
          aggregatesProcessed: current.aggregatesProcessed,
          eventsProcessed: current.eventsProcessed,
        },
      });
    }
    await this.repo.releaseLock({ runId: params.runId });
  }
}

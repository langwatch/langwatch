import { createLogger } from "@langwatch/telemetry";
import { randomUUID } from "crypto";
import { env } from "~/env.mjs";
import { createReplayRuntime } from "~/server/event-sourcing/replay/replayPreset";
import type { ReplayProgress } from "~/server/event-sourcing/replay/types";
import type {
  ReplayHistoryEntry,
  ReplayRepository,
  ReplayStatus,
} from "./repositories/replay.repository";

const logger = createLogger("langwatch:ops:replay-service");

const REPLAY_LOCK_TTL_SECONDS = 3600;

/**
 * How often (at most) the running replay re-extends its lock from progress
 * callbacks. Batch completions also refresh unconditionally — together they
 * keep the lock alive for runs longer than REPLAY_LOCK_TTL_SECONDS, whose
 * expiry used to silently stop status updates mid-run.
 */
export const LOCK_REFRESH_INTERVAL_MS = 60_000;

class ReplayCancelledError extends Error {
  constructor() {
    super("Replay cancelled");
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
    await this.repo.setCancelled({ ttlSeconds: 60 });
    return { cancelled: true };
  }

  private async executeReplay(params: {
    runId: string;
    projectionNames: string[];
    since: string;
    tenantIds: string[];
    aggregateIds?: string[];
    description: string;
    userName: string;
  }): Promise<void> {
    const redisUrl = env.REDIS_URL;
    if (!redisUrl) {
      await this.finalizeWithError({
        runId: params.runId,
        errorMessage: "REDIS_URL is not configured",
      });
      return;
    }

    let runtime;
    try {
      runtime = createReplayRuntime({ redisUrl });
    } catch (err) {
      await this.finalizeWithError({
        runId: params.runId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    try {
      const selectedProjections = runtime.projections.filter((p) =>
        params.projectionNames.includes(p.projectionName),
      );
      const selectedMapProjections = runtime.mapProjections.filter((p) =>
        params.projectionNames.includes(p.projectionName),
      );

      if (selectedProjections.length === 0 && selectedMapProjections.length === 0) {
        await this.finalizeWithError({
          runId: params.runId,
          errorMessage: "No matching projections found",
        });
        return;
      }

      const cancelledBeforeStart = await this.repo.isCancelled();
      if (cancelledBeforeStart) {
        await this.finalizeCancelled({ runId: params.runId, historyCtx: params });
        return;
      }

      let cancelledFlag = false;
      let lastCancelCheck = Date.now();
      const CANCEL_CHECK_INTERVAL_MS = 3000;

      let lastLockRefresh = Date.now();
      const refreshLock = () => {
        lastLockRefresh = Date.now();
        this.repo
          .refreshLock({
            runId: params.runId,
            ttlSeconds: REPLAY_LOCK_TTL_SECONDS,
          })
          .then((stillHeld) => {
            if (!stillHeld) {
              // Lock expired and another run took over — abort this stale
              // run via the existing cancellation path so it stops touching
              // the shared projection pause keys.
              logger.warn(
                { runId: params.runId },
                "Replay lock lost to another run; aborting stale replay",
              );
              cancelledFlag = true;
            }
          })
          .catch((err) => {
            logger.warn({ error: err }, "Failed to refresh replay lock");
          });
      };

      const result = await runtime.service.replayOptimized(
        {
          projections: selectedProjections,
          mapProjections: selectedMapProjections,
          tenantIds: params.tenantIds,
          since: params.since,
          aggregateIds: params.aggregateIds,
        },
        {
          // Heartbeat: refresh the lock at least once per completed batch so
          // a run longer than the lock TTL never loses it mid-flight.
          onBatchComplete: () => {
            refreshLock();
          },
          onProgress: (progress: ReplayProgress) => {
            this.updateProgress({ runId: params.runId, progress }).catch(
              (err) => {
                logger.warn(
                  { error: err },
                  "Failed to update replay progress",
                );
              },
            );

            const now = Date.now();
            if (now - lastCancelCheck > CANCEL_CHECK_INTERVAL_MS) {
              lastCancelCheck = now;
              this.repo
                .isCancelled()
                .then((cancelled) => {
                  if (cancelled) cancelledFlag = true;
                })
                .catch(() => {});
            }

            // Also refresh from progress emits, time-gated — covers a single
            // batch that runs longer than one lock refresh interval.
            if (now - lastLockRefresh > LOCK_REFRESH_INTERVAL_MS) {
              refreshLock();
            }

            if (cancelledFlag) {
              throw new ReplayCancelledError();
            }
          },
        },
      );

      const lockHolder = await this.repo.getLockHolder();
      if (lockHolder !== params.runId) return;

      if (result.batchErrors > 0) {
        await this.finalizeWithError({
          runId: params.runId,
          errorMessage: result.firstError ?? "Unknown batch error",
          historyCtx: params,
        });
      } else {
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
    } catch (err) {
      // If another run has taken the lock over, it owns the status row now —
      // finalizing here would overwrite the successor's "running" status with
      // this stale run's cancelled/failed state. A null holder (expired, no
      // successor) still finalizes so the run's end state stays observable.
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
          errorMessage:
            err instanceof Error ? err.message : String(err),
          historyCtx: params,
        });
      }
    } finally {
      await runtime.close();
      await this.repo.releaseLock({ runId: params.runId });
    }
  }

  private async updateProgress(params: {
    runId: string;
    progress: ReplayProgress;
  }): Promise<void> {
    const lockHolder = await this.repo.getLockHolder();
    if (lockHolder !== params.runId) return;

    const current = await this.repo.getStatus();
    if (current.state !== "running" || current.runId !== params.runId)
      return;

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

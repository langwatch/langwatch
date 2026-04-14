import { randomUUID } from "crypto";
import type {
  ReplayRepository,
  ReplayStatus,
  ReplayHistoryEntry,
} from "./repositories/replay.repository";
import { createReplayRuntime } from "~/server/event-sourcing/replay/replayPreset";
import type { ReplayProgress } from "~/server/event-sourcing/replay/types";
import { env } from "~/env.mjs";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:ops:replay-service");

const REPLAY_LOCK_TTL_SECONDS = 3600;

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

  async startReplay(params: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
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

      if (selectedProjections.length === 0) {
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

      const result = await runtime.service.replayOptimized(
        {
          projections: selectedProjections,
          tenantIds: params.tenantIds,
          since: params.since,
        },
        {
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
      if (err instanceof ReplayCancelledError) {
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

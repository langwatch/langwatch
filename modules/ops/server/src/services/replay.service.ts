// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import type { ReplayProgress } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { randomUUID } from "crypto";
import type { ReplayHistoryEntry, ReplayStatus } from "@langwatch/ops-contract";
import type { ReplayRepository } from "../repositories/replay.repository.ts";
import type { OpsReplayRuntime, OpsReplayRuntimePort } from "../ports/replay-runtime.port.ts";
import { ReplayLockHeartbeatService } from "./replay-lock-heartbeat.service.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:ops:replay-service");

const REPLAY_LOCK_TTL_SECONDS = 3600;

/** The projections one run covers, split by kind, with how many there are in all. */
interface ReplaySelection {
  projections: OpsReplayRuntime["projections"];
  mapProjections: OpsReplayRuntime["mapProjections"];
  stateProjections: OpsReplayRuntime["stateProjections"];
  length: number;
}

class ReplayCancelledError extends Error {
  constructor() {
    super("Replay cancelled");
  }
}

export class ReplayService {
  static create({
    repo,
    runtimeFactory,
  }: {
    repo: ReplayRepository;
    runtimeFactory: OpsReplayRuntimePort;
  }): ReplayService {
    return new ReplayService(repo, runtimeFactory);
  }

  private constructor(
    readonly repo: ReplayRepository,
    private readonly runtimeFactory: OpsReplayRuntimePort,
  ) {}

  async getStatus(): Promise<ReplayStatus> {
    return this.repo.getStatus();
  }

  async getHistory(): Promise<ReplayHistoryEntry[]> {
    return this.repo.getHistory();
  }

  async tryFindHistoryEntry(params: { runId: string }): Promise<ReplayHistoryEntry | null> {
    const history = await this.repo.getHistory();

    return history.find((entry) => entry.runId === params.runId) ?? null;
  }

  async startReplay(params: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
    aggregateIds?: string[];
    /**
     * Rebuild from scratch instead of resuming: clear the selected projections' replay markers
     * (completed set and in-flight cutoffs) under the replay lock, before discovery, so every
     * discovered aggregate is replayed rather than skipped as already done.
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
      startedAt: nowInstant().toString({ fractionalSecondDigits: 3 }),
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
        logger.error({ error: err, runId }, "Unexpected replay orchestration error");
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
    let runtime;
    try {
      runtime = this.runtimeFactory.create();
    } catch (err) {
      await this.finalizeWithError({
        runId: params.runId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });

      return;
    }

    try {
      const selection = ReplayService.selectProjections(runtime, params.projectionNames);
      if (selection.length === 0) {
        await this.finalizeWithError({
          runId: params.runId,
          errorMessage: "No matching projections found",
        });

        return;
      }

      if (await this.repo.isCancelled()) {
        await this.finalizeCancelled({ runId: params.runId, historyCtx: params });

        return;
      }

      if (params.fullRebuild) {
        await this.clearReplayMarkers({ runtime, runId: params.runId, selection });
      }

      const result = await this.runWithHeartbeat({ runtime, params, selection });

      // Mirror the catch-path guard: only a takeover by another run skips finalization. A null
      // holder — lock expired, no successor — still finalizes, so a completed run is never left
      // stuck as running.
      const lockHolder = await this.repo.tryGetLockHolder();
      if (lockHolder !== null && lockHolder !== params.runId) {
        return;
      }

      if (result.batchErrors > 0) {
        await this.finalizeWithError({
          runId: params.runId,
          errorMessage: result.firstError ?? "Unknown batch error",
          historyCtx: params,
        });

        return;
      }

      await this.finalizeCompleted({ params, result });
    } catch (err) {
      // A run that has lost the lock owns nothing: finalizing would overwrite the successor's
      // running status with this stale run's end state. A null holder still finalizes, so the
      // run's end state stays observable.
      const lockHolder = await this.repo.tryGetLockHolder();
      if (lockHolder !== null && lockHolder !== params.runId) {
        logger.warn(
          { runId: params.runId, lockHolder },
          "Skipping replay finalization: lock now held by another run",
        );
      } else if (err instanceof ReplayCancelledError) {
        await this.finalizeCancelled({ runId: params.runId, historyCtx: params });
      } else {
        await this.finalizeWithError({
          runId: params.runId,
          errorMessage: err instanceof Error ? err.message : String(err),
          historyCtx: params,
        });
      }
    } finally {
      await runtime.close();
      await this.repo.releaseLock({ runId: params.runId });
    }
  }

  /** The projections this run covers, split by kind, in the shape the runtime replays them. */
  private static selectProjections(
    runtime: OpsReplayRuntime,
    projectionNames: string[],
  ): ReplaySelection {
    const named = <T extends { projectionName: string }>(all: T[]): T[] =>
      all.filter((projection) => projectionNames.includes(projection.projectionName));
    const projections = named(runtime.projections);
    const mapProjections = named(runtime.mapProjections);
    const stateProjections = named(runtime.stateProjections);

    return {
      projections,
      mapProjections,
      stateProjections,
      length: projections.length + mapProjections.length + stateProjections.length,
    };
  }

  /**
   * Under the replay lock and before discovery, the markers a resume would consult are dropped so
   * no aggregate is skipped as already done. A failure here aborts the run rather than replaying
   * against stale markers, which is the silent skip a full rebuild exists to prevent.
   */
  private async clearReplayMarkers({
    runtime,
    runId,
    selection,
  }: {
    runtime: OpsReplayRuntime;
    runId: string;
    selection: ReplaySelection;
  }): Promise<void> {
    for (const projection of [
      ...selection.projections,
      ...selection.mapProjections,
      ...selection.stateProjections,
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

  /**
   * Runs the replay while a standalone timer refreshes the lock and polls the cancel flag, so both
   * survive a batch phase that emits no callbacks for longer than the lock's own lifetime. Losing
   * the lock to another run aborts this one through the same cancellation path.
   */
  private async runWithHeartbeat({
    runtime,
    params,
    selection,
  }: {
    runtime: OpsReplayRuntime;
    params: { runId: string; since: string; tenantIds: string[]; aggregateIds?: string[] };
    selection: ReplaySelection;
  }) {
    const heartbeat = ReplayLockHeartbeatService.create({ repo: this.repo, runId: params.runId });
    heartbeat.start();
    try {
      // One entry point for every selection: folds and maps run through the shared batch engine,
      // each batch's events loaded once, and state projections rebuild afterwards in their own
      // paused lane, so selecting one no longer demotes the run's folds and maps.
      return await runtime.service.replay(
        {
          projections: selection.projections,
          mapProjections: selection.mapProjections,
          stateProjections: selection.stateProjections,
          tenantIds: params.tenantIds,
          since: params.since,
          aggregateIds: params.aggregateIds,
        },
        {
          onProgress: (progress: ReplayProgress) => {
            this.updateProgress({ runId: params.runId, progress }).catch((err) => {
              logger.warn({ error: err }, "Failed to update replay progress");
            });

            heartbeat.pollCancelledThrottled();
            if (heartbeat.cancelled) {
              throw new ReplayCancelledError();
            }
          },
        },
      );
    } finally {
      heartbeat.stop();
    }
  }

  /** The completed run, written to the status row and pushed onto the history list. */
  private async finalizeCompleted({
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
    const completedAt = nowInstant().toString({ fractionalSecondDigits: 3 });
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

  private async updateProgress(params: { runId: string; progress: ReplayProgress }): Promise<void> {
    const lockHolder = await this.repo.tryGetLockHolder();
    if (lockHolder !== params.runId) {
      return;
    }

    const current = await this.repo.getStatus();
    if (current.state !== "running" || current.runId !== params.runId) {
      return;
    }

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
    logger.error({ runId: params.runId, error: params.errorMessage }, "Replay failed");
    const current = await this.repo.getStatus();
    const completedAt = nowInstant().toString({ fractionalSecondDigits: 3 });
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
    const completedAt = nowInstant().toString({ fractionalSecondDigits: 3 });
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

// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import type {
  Registry,
  ReplayReport,
  ReplayRequest,
} from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { randomUUID } from "crypto";
import type {
  ReplayHistoryEntry,
  ReplayRepository,
  ReplayStatus,
} from "./repositories/replay.repository";

const logger = createLogger("langwatch:ops:replay-service");

const REPLAY_LOCK_TTL_SECONDS = 3600;

/**
 * How often the running replay re-extends its lock on a standalone heartbeat
 * timer. Running independently of slice boundaries keeps the lock alive even
 * when a single slice (a huge tenant's scan, a slow ClickHouse read) reports
 * nothing for longer than REPLAY_LOCK_TTL_SECONDS, whose expiry used to
 * silently stop status updates mid-run.
 */
export const LOCK_REFRESH_INTERVAL_MS = 60_000;

/** The engine surface a replay needs: what is registered, and the replay itself. */
export interface ReplayEngine {
  readonly registry: Registry;
  replay(request: ReplayRequest): Promise<ReplayReport>;
}

class ReplayCancelledError extends Error {
  constructor() {
    super("Replay cancelled");
  }
}

export class ReplayService {
  constructor(
    readonly repo: ReplayRepository,
    private readonly engine: ReplayEngine,
  ) {}

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
    // TTL matches the lock TTL so the flag cannot expire between polls during
    // a long slice — the heartbeat checks it every LOCK_REFRESH_INTERVAL_MS.
    await this.repo.setCancelled({ ttlSeconds: REPLAY_LOCK_TTL_SECONDS });
    return { cancelled: true };
  }

  /**
   * The requests one run expands into. Replay reads the event log one tenant
   * and one aggregate type at a time, so an operator's projection selection is
   * resolved through the registry to the pipelines that own those projections,
   * and the run is the cross product with the tenants — and aggregates, when
   * named — the operator asked for.
   */
  private planRequests(params: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
    aggregateIds?: string[];
  }): ReplayRequest[] {
    const occurredFrom = new Date(params.since).getTime();
    const byAggregateType = new Map<string, string[]>();
    for (const { pipeline, aggregateType } of this.engine.registry.all()) {
      const selected = [
        ...Object.keys(pipeline.folds),
        ...Object.keys(pipeline.maps),
      ].filter((name) => params.projectionNames.includes(name));
      if (selected.length > 0) byAggregateType.set(aggregateType, selected);
    }

    const aggregateIds =
      params.aggregateIds && params.aggregateIds.length > 0
        ? params.aggregateIds
        : [undefined];

    return params.tenantIds.flatMap((tenantId) =>
      [...byAggregateType].flatMap(([aggregateType, projections]) =>
        aggregateIds.map((aggregateId) => ({
          tenantId,
          aggregateType,
          projections,
          ...(aggregateId === undefined ? {} : { aggregateId }),
          ...(Number.isFinite(occurredFrom) ? { occurredFrom } : {}),
        })),
      ),
    );
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
    // The event log is scanned per tenant, so "every tenant" is not a shape
    // replay can express — an unscoped run would be an unbounded cross-tenant
    // table scan rather than a wide one.
    if (params.tenantIds.length === 0) {
      await this.finalizeWithError({
        runId: params.runId,
        errorMessage: "Replay requires at least one tenant",
      });
      return;
    }

    const requests = this.planRequests(params);
    if (requests.length === 0) {
      await this.finalizeWithError({
        runId: params.runId,
        errorMessage: "No matching projections found",
      });
      return;
    }

    try {
      if (await this.repo.isCancelled()) {
        await this.finalizeCancelled({
          runId: params.runId,
          historyCtx: params,
        });
        return;
      }

      let cancelledFlag = false;

      const heartbeatTick = () => {
        this.repo
          .refreshLock({
            runId: params.runId,
            ttlSeconds: REPLAY_LOCK_TTL_SECONDS,
          })
          .then((stillHeld) => {
            if (!stillHeld) {
              // Lock expired and another run took over — abort this stale run
              // via the existing cancellation path so it stops writing the
              // shared status. Warn once and stop the heartbeat: the lock is
              // confirmed gone, so there is nothing left to refresh and no
              // point re-warning every interval.
              logger.warn(
                { runId: params.runId },
                "Replay lock lost to another run; aborting stale replay",
              );
              cancelledFlag = true;
              clearInterval(heartbeat);
            }
          })
          .catch((err) => {
            logger.warn({ error: err }, "Failed to refresh replay lock");
          });

        this.repo
          .isCancelled()
          .then((cancelled) => {
            if (cancelled) cancelledFlag = true;
          })
          .catch((err) => {
            logger.warn({ error: err }, "Failed to poll replay cancel flag");
          });
      };

      const heartbeat = setInterval(heartbeatTick, LOCK_REFRESH_INTERVAL_MS);
      heartbeat.unref();

      let processed = 0;
      let events = 0;
      try {
        for (const request of requests) {
          if (cancelledFlag) throw new ReplayCancelledError();
          const report = await this.engine.replay(request);
          processed += 1;
          events += report.events;
          await this.updateProgress({
            runId: params.runId,
            currentProjection: request.aggregateType,
            processed,
            total: requests.length,
            events,
          });
          if (await this.repo.isCancelled()) cancelledFlag = true;
        }
        if (cancelledFlag) throw new ReplayCancelledError();
      } finally {
        clearInterval(heartbeat);
      }

      // Mirror the catch-path guard: only a takeover by ANOTHER run skips
      // finalization. A null holder (lock expired, no successor) still
      // finalizes so a completed run is never left stuck in "running".
      const lockHolder = await this.repo.getLockHolder();
      if (lockHolder !== null && lockHolder !== params.runId) return;

      const completedAt = new Date().toISOString();
      const status = await this.repo.getStatus();
      await this.repo.writeStatus({
        status: {
          ...status,
          state: "completed",
          completedAt,
          aggregatesProcessed: processed,
          eventsProcessed: events,
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
          aggregatesProcessed: processed,
          eventsProcessed: events,
        },
      });
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
          errorMessage: err instanceof Error ? err.message : String(err),
          historyCtx: params,
        });
      }
    } finally {
      await this.repo.releaseLock({ runId: params.runId });
    }
  }

  /** `aggregatesProcessed` counts replay requests: one per tenant × aggregate
   * type, or per aggregate when the operator named specific ones. */
  private async updateProgress(params: {
    runId: string;
    currentProjection: string;
    processed: number;
    total: number;
    events: number;
  }): Promise<void> {
    const lockHolder = await this.repo.getLockHolder();
    if (lockHolder !== params.runId) return;

    const current = await this.repo.getStatus();
    if (current.state !== "running" || current.runId !== params.runId) return;

    await this.repo.writeStatus({
      status: {
        ...current,
        currentProjection: params.currentProjection,
        aggregatesProcessed: params.processed,
        aggregatesTotal: params.total,
        eventsProcessed: params.events,
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

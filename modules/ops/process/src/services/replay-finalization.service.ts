import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { ReplayRepository } from "../repositories/replay.repository.ts";

const logger = createLogger("langwatch:ops:replay-service");

/** A replay run's end state, written to the status row and, given a history context, to history. */
export class ReplayFinalizationService {
  static create({ repo }: { repo: ReplayRepository }): ReplayFinalizationService {
    return new ReplayFinalizationService(repo);
  }

  private constructor(private readonly repo: ReplayRepository) {}

  /** The completed run, written to the status row and pushed onto the history list. */
  async finalizeCompleted({
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

  async finalizeWithError(params: {
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

  async finalizeCancelled(params: {
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

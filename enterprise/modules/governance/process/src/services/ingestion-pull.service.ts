import {
  PULL_FAILED_ERROR_CODE,
  PULL_REFUSED_ERROR_CODE,
} from "@langwatch/enterprise-governance-contract";
import { isDispatchError } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";

import type {
  IngestionPullMetricsSink,
  IngestionPullOutcomeChannel,
  IngestionPullRun,
  IngestionPullRunResult,
  IngestionPullRunner,
} from "../app/governance.members.ts";
import { providerWaitOnError } from "../rules/ingestion-pull-cooldown.rules.ts";

export const INGESTION_PULL_MAX_ATTEMPTS = 3;
export const INGESTION_PULL_LEASE_DURATION_MS = 10 * 60 * 1000;
export const INGESTION_PULL_CONCURRENCY = 4;

export type IngestionPullExecution = {
  tenantId: string;
  attempt: number;
  pull: IngestionPullRun;
};

/** One pull attempt from the durable cursor; ports main's `createIngestionPullRunHandler`. */
export class IngestionPullService {
  private readonly maxAttempts: number;
  private readonly clock: () => number;
  private readonly runPort: IngestionPullRunner;
  private readonly outcomePort: IngestionPullOutcomeChannel;
  private readonly metrics: IngestionPullMetricsSink;
  private readonly logger: Logger;

  private constructor({
    runPort,
    outcomePort,
    metrics,
    options = {},
  }: {
    runPort: IngestionPullRunner;
    outcomePort: IngestionPullOutcomeChannel;
    metrics: IngestionPullMetricsSink;
    options?: { maxAttempts?: number; clock?: () => number; logger?: Logger };
  }) {
    this.runPort = runPort;
    this.outcomePort = outcomePort;
    this.metrics = metrics;
    this.maxAttempts = options.maxAttempts ?? INGESTION_PULL_MAX_ATTEMPTS;
    this.clock = options.clock ?? Date.now;
    this.logger = options.logger ?? createLogger("langwatch:governance:ingestion-pull-effects");
  }

  static create({
    runPort,
    outcomePort,
    metrics,
    options = {},
  }: {
    runPort: IngestionPullRunner;
    outcomePort: IngestionPullOutcomeChannel;
    metrics: IngestionPullMetricsSink;
    options?: { maxAttempts?: number; clock?: () => number; logger?: Logger };
  }): IngestionPullService {
    return new IngestionPullService({ runPort, outcomePort, metrics, options });
  }

  async execute(input: IngestionPullExecution): Promise<void> {
    const startedAt = this.clock();
    await this.recordAbandonmentIfReplacing(input);

    let result: IngestionPullRunResult;
    try {
      result = await this.runPort.run({
        sourceId: input.pull.sourceId,
        cursor: input.pull.cursor,
      });
    } catch (error) {
      await this.settleFailedPull({ input, error });
      return;
    }

    this.metrics.count("completed");
    this.metrics.observeDuration(this.clock() - startedAt);
    await this.outcomePort.completed({
      tenantId: input.tenantId,
      occurredAt: this.clock(),
      sourceId: input.pull.sourceId,
      runId: input.pull.runId,
      scheduledFor: input.pull.scheduledFor,
      ...result,
    });
  }

  /** On every delivery: the abandonment's idempotency key settles a redelivery onto one write. */
  private async recordAbandonmentIfReplacing(input: IngestionPullExecution): Promise<void> {
    const abandonedRunId = input.pull.abandonedRunId;
    if (abandonedRunId === undefined) return;
    await this.outcomePort.failed({
      tenantId: input.tenantId,
      occurredAt: this.clock(),
      sourceId: input.pull.sourceId,
      runId: abandonedRunId,
      scheduledFor: input.pull.scheduledFor,
      error: `Run abandoned after exceeding its allowed duration; replaced by run ${input.pull.runId}.`,
      errorCode: "run_abandoned",
      retryable: false,
      replacedByRunId: input.pull.runId,
    });
  }

  private async settleFailedPull({
    input,
    error,
  }: {
    input: IngestionPullExecution;
    error: unknown;
  }): Promise<void> {
    const detail = error instanceof Error ? error.message : String(error);
    if (isDispatchError(error) && !error.retryable) {
      this.metrics.count("failed_final");
      this.logger.warn(
        { sourceId: input.pull.sourceId, attempt: input.attempt, error: detail },
        "Ingestion pull refused by the provider; not retrying this run",
      );
      const refusal =
        error.customerMessage === undefined
          ? { error: detail, errorCode: PULL_FAILED_ERROR_CODE }
          : { error: error.customerMessage, errorCode: PULL_REFUSED_ERROR_CODE };
      await this.outcomePort.failed({
        ...this.failureEnvelope(input),
        ...refusal,
        retryable: false,
        retryAfterMs: this.retryAfterMsOf(error),
      });
      return;
    }
    if (input.attempt < this.maxAttempts) {
      this.metrics.count("failed_retryable");
      this.logger.warn(
        { sourceId: input.pull.sourceId, attempt: input.attempt, error: detail },
        "Ingestion pull failed; retrying from durable cursor",
      );
      throw error;
    }
    this.metrics.count("failed_final");
    await this.outcomePort.failed({
      ...this.failureEnvelope(input),
      error: detail,
      errorCode: PULL_FAILED_ERROR_CODE,
      retryable: false,
      retryAfterMs: this.retryAfterMsOf(error),
    });
  }

  /** The wire field: a named wait in milliseconds, null when the provider named none. */
  private retryAfterMsOf(error: unknown) {
    const wait = providerWaitOnError(error);
    return wait.outcome === "named" ? wait.retryAfterMs : null;
  }

  private failureEnvelope(input: IngestionPullExecution) {
    return {
      tenantId: input.tenantId,
      occurredAt: this.clock(),
      sourceId: input.pull.sourceId,
      runId: input.pull.runId,
      scheduledFor: input.pull.scheduledFor,
    };
  }
}

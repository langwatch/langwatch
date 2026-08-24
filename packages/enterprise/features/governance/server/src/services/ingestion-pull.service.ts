import type {
  IngestionPullMetricsPort,
  IngestionPullOutcomePort,
  IngestionPullRun,
  IngestionPullRunPort,
} from "../ports/ingestion-pull.port";

export const INGESTION_PULL_MAX_ATTEMPTS = 3;
export const INGESTION_PULL_LEASE_DURATION_MS = 10 * 60 * 1000;
export const INGESTION_PULL_CONCURRENCY = 4;

export type IngestionPullExecution = {
  tenantId: string;
  attempt: number;
  pull: IngestionPullRun;
};

export class IngestionPullService {
  private readonly maxAttempts: number;
  private readonly clock: () => number;

  constructor(
    private readonly runPort: IngestionPullRunPort,
    private readonly outcomePort: IngestionPullOutcomePort,
    private readonly metrics: IngestionPullMetricsPort,
    options: { maxAttempts?: number; clock?: () => number } = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? INGESTION_PULL_MAX_ATTEMPTS;
    this.clock = options.clock ?? Date.now;
  }

  static create(
    runPort: IngestionPullRunPort,
    outcomePort: IngestionPullOutcomePort,
    metrics: IngestionPullMetricsPort,
    options: { maxAttempts?: number; clock?: () => number } = {},
  ): IngestionPullService {
    return new IngestionPullService(runPort, outcomePort, metrics, options);
  }

  async execute(input: IngestionPullExecution): Promise<void> {
    const startedAt = this.clock();
    let result: Awaited<ReturnType<IngestionPullRunPort["run"]>>;
    try {
      result = await this.runPort.run({
        sourceId: input.pull.sourceId,
        cursor: input.pull.cursor,
      });
    } catch (error) {
      if (input.attempt < this.maxAttempts) {
        this.metrics.count("failed_retryable");
        throw error;
      }
      this.metrics.count("failed_final");
      await this.outcomePort.failed({
        tenantId: input.tenantId,
        occurredAt: this.clock(),
        sourceId: input.pull.sourceId,
        runId: input.pull.runId,
        scheduledFor: input.pull.scheduledFor,
        error: error instanceof Error ? error.message : String(error),
        errorCode: "pull_failed",
        retryable: false,
      });
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
}

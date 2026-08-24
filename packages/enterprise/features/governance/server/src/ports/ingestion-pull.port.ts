export type IngestionPullRun = {
  sourceId: string;
  runId: string;
  scheduledFor: number;
  cursor: string | null;
};

export abstract class IngestionPullRunPort {
  abstract run(input: {
    sourceId: string;
    cursor: string | null;
  }): Promise<{ nextCursor: string | null; eventCount: number }>;
}

export abstract class IngestionPullOutcomePort {
  abstract completed(input: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    runId: string;
    scheduledFor: number;
    nextCursor: string | null;
    eventCount: number;
  }): Promise<void>;

  abstract failed(input: {
    tenantId: string;
    occurredAt: number;
    sourceId: string;
    runId: string;
    scheduledFor: number;
    error: string;
    errorCode: string;
    retryable: false;
  }): Promise<void>;
}

export abstract class IngestionPullMetricsPort {
  abstract count(
    outcome: "completed" | "failed_retryable" | "failed_final",
  ): void;
  abstract observeDuration(durationMs: number): void;
}

/** UTC schedule calculation supplied by the worker composition root. */
export abstract class IngestionPullSchedulePort {
  abstract nextRunAt(input: { cron: string; after: number }): number;
}

import { createLogger } from "@langwatch/observability";
import { getLangWatchTracer } from "langwatch";

type TraceInput = {
  name: string;
  attributes: Record<string, string | number>;
};

type OldRunWarning = {
  projectId: string;
  oldestRunAgeDays: number;
  runCount: number;
  occurredAtBufferHours: number;
};

type RunHistoryError = {
  projectId: string;
  experimentId?: string;
  runId?: string;
  error: unknown;
};

/** App-owned telemetry for the canonical Experiment run-history repository. */
export class AppExperimentRunHistoryTelemetry {
  static create(): AppExperimentRunHistoryTelemetry {
    return new AppExperimentRunHistoryTelemetry();
  }

  private readonly logger = createLogger("langwatch:experiment-runs:service");
  private readonly tracer = getLangWatchTracer("langwatch.experiment-runs.service");

  private constructor() {}

  trace<T>(input: TraceInput, operation: () => Promise<T>): Promise<T> {
    return this.tracer.withActiveSpan(
      input.name,
      { attributes: input.attributes },
      operation,
    );
  }

  warnOldRuns(input: OldRunWarning): void {
    this.logger.warn(
      input,
      "Querying experiment runs with very old CreatedAt; if users report missing items, OCCURRED_AT_BUFFER_MS may need to widen",
    );
  }

  error(input: RunHistoryError, message: string): void {
    this.logger.error(input, message);
  }

  warn(input: { projectId: string; error: unknown }, message: string): void {
    this.logger.warn(input, message);
  }
}

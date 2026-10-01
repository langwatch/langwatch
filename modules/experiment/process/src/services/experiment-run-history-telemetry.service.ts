import type { Logger } from "@langwatch/observability";

/**
 * Run-history telemetry, reported through this process's own logger. The
 * trace wrapper is a pass-through: this process's tracer wraps the request,
 * and a second span per run-history read would only restate it.
 */
export class ExperimentRunHistoryTelemetryService {
  static create(logger: Pick<Logger, "warn" | "error">): ExperimentRunHistoryTelemetryService {
    return new ExperimentRunHistoryTelemetryService(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn" | "error">) {}

  trace<T>(
    _input: { name: string; attributes: Record<string, string | number> },
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }

  warnOldRuns(input: {
    projectId: string;
    oldestRunAgeDays: number;
    runCount: number;
    occurredAtBufferHours: number;
  }): void {
    this.logger.warn(input, "experiment run history reached far back in time");
  }

  error(
    input: { projectId: string; experimentId?: string; runId?: string; error: unknown },
    message: string,
  ): void {
    this.logger.error(input, message);
  }

  warn(input: { projectId: string; error: unknown }, message: string): void {
    this.logger.warn(input, message);
  }
}

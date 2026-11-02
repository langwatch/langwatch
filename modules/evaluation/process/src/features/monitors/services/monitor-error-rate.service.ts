import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { MonitorErrorRateRepository } from "../../../repositories/monitor-error-rate.repository.ts";
import {
  isCountedMonitorRun,
  isMonitorErrorRateExceeded,
  MONITOR_ERROR_RATE_WINDOW_MS,
  type MonitorRunOutcome,
  normalizeMonitorErrorMessage,
} from "../../../rules/monitor-error-rate.rules.ts";
import type { EvaluationLifecycleService } from "../../../services/evaluation-lifecycle.service.ts";

const logger = createLogger("langwatch:evaluation:monitor-error-rate");

/** The settled run, as the execution outcome knows it. */
type ObservedMonitorRun = Readonly<{
  projectId: string;
  monitorId: string;
  /** The monitor's `updatedAt` in epoch milliseconds: a change to it starts the count again. */
  monitorRevision: number;
  executionMode: string;
  isGuardrail: boolean;
  outcome: MonitorRunOutcome;
  error?: string | null;
}>;

/**
 * Counts each on-message monitor's settled runs and records, once per monitor revision, that most
 * of the last hour's runs errored. Monitor pauses itself from its own side.
 * Spec: modules/evaluation/specs/monitor-error-rate.feature
 */
export class MonitorErrorRateService {
  static create(input: {
    counts: MonitorErrorRateRepository;
    lifecycle: Pick<EvaluationLifecycleService, "monitorErrorRateExceeded">;
  }): MonitorErrorRateService {
    return new MonitorErrorRateService(input);
  }

  private constructor(
    private readonly deps: {
      counts: MonitorErrorRateRepository;
      lifecycle: Pick<EvaluationLifecycleService, "monitorErrorRateExceeded">;
    },
  ) {}

  /** Never throws: an evaluation is never failed for want of a count. */
  async observe(run: ObservedMonitorRun): Promise<void> {
    try {
      await this.count(run);
    } catch (error) {
      logger.warn(
        { error, projectId: run.projectId, monitorId: run.monitorId },
        "the monitor's error rate was not counted",
      );
    }
  }

  private async count(run: ObservedMonitorRun): Promise<void> {
    const { outcome } = run;
    if (outcome === "skipped") return;
    if (!isCountedMonitorRun({ executionMode: run.executionMode, isGuardrail: run.isGuardrail })) {
      return;
    }

    const key = {
      projectId: run.projectId,
      monitorId: run.monitorId,
      monitorRevision: run.monitorRevision,
    };
    const now = nowInstant().epochMilliseconds;
    const counts = await this.deps.counts.record({
      ...key,
      outcome,
      ...(outcome === "error" && run.error
        ? { errorMessage: normalizeMonitorErrorMessage(run.error) }
        : {}),
      now,
    });
    if (outcome !== "error" || !isMonitorErrorRateExceeded(counts)) return;
    if (!(await this.deps.counts.claimReport(key))) return;

    try {
      const [topError = null] = await this.deps.counts.findTopErrors({ ...key, now });
      logger.warn(
        { ...key, ...counts, topError },
        "most of a monitor's recent evaluations errored; recording it so the monitor pauses",
      );
      await this.deps.lifecycle.monitorErrorRateExceeded({
        projectId: run.projectId,
        monitorId: run.monitorId,
        monitorRevision: run.monitorRevision,
        occurredAt: now,
        windowMs: MONITOR_ERROR_RATE_WINDOW_MS,
        runs: counts.runs,
        errors: counts.errors,
        topError,
      });
    } catch (error) {
      // The next error claims it again; the fact's idempotency key keeps it one event.
      await this.deps.counts.releaseReport(key);
      throw error;
    }
  }
}

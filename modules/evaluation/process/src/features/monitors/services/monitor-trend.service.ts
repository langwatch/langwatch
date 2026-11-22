import {
  monitorPerformanceForProjectInputSchema,
  type MonitorPerformanceForProjectInput,
  type OnlineEvaluationPerformance,
} from "@langwatch/evaluation-contract";
import { findEvaluatorDefinitions } from "@langwatch/evaluator-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { nowInstant } from "@langwatch/time";

import { previousPeriodStartMs } from "../../../rules/monitor-performance-window.rules.ts";
import type { MonitorPerformanceService } from "./monitor-performance.service.ts";

/** The window the performance strip reports, and compares to the one before it. */
const PERFORMANCE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The monitors page's seven-day trend: the window, each monitor's guardrail
 * flag, and the answer for a project with no monitors live here.
 */
export class MonitorTrendService {
  static create(deps: {
    monitors: Pick<MonitorApi, "list">;
    performance: Pick<MonitorPerformanceService, "getMonitorPerformance">;
  }): MonitorTrendService {
    return new MonitorTrendService(deps);
  }

  private constructor(
    private readonly deps: {
      monitors: Pick<MonitorApi, "list">;
      performance: Pick<MonitorPerformanceService, "getMonitorPerformance">;
    },
  ) {}

  async findForProject(
    input: MonitorPerformanceForProjectInput,
  ): Promise<OnlineEvaluationPerformance[]> {
    const { projectId, timeZone } = monitorPerformanceForProjectInputSchema.parse(input);
    const monitors = await this.deps.monitors.list({ projectId });
    if (monitors.length === 0) return [];

    const endMs = nowInstant().epochMilliseconds;
    const currentStartMs = endMs - PERFORMANCE_PERIOD_MS;

    return this.deps.performance.getMonitorPerformance({
      tenantId: projectId,
      monitors: monitors.map((monitor) => ({
        id: monitor.id,
        isGuardrail: findEvaluatorDefinitions(monitor.checkType)[0]?.isGuardrail ?? false,
      })),
      previousStartMs: previousPeriodStartMs({ startMs: currentStartMs, endMs }),
      currentStartMs,
      endMs,
      timeZone: timeZone ?? "UTC",
    });
  }
}

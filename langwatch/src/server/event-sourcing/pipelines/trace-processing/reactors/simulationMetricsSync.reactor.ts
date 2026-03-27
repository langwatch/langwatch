import { createLogger } from "../../../../../utils/logger/server";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TraceProcessingEvent } from "../schemas/events";
import type { UpdateRunMetricsCommandData } from "../../simulation-processing/schemas/commands";

const logger = createLogger(
  "langwatch:trace-processing:simulation-metrics-sync",
);

export interface SimulationMetricsSyncReactorDeps {
  updateRunMetrics: (data: UpdateRunMetricsCommandData) => Promise<void>;
}

/**
 * Trace-side reactor: when a trace with scenario.run_id arrives,
 * propagates per-role cost/latency metrics to the simulation run.
 *
 * Zero queries — reads scenario_run_id directly from the trace's hoisted
 * span attributes.
 *
 * Complements the simulation-side traceMetricsSync reactor:
 * - Simulation-side handles "events arrive first, trace later" by reading
 *   the trace summary when simulation events arrive.
 * - This trace-side reactor handles "trace arrives after events" by
 *   dispatching metrics directly using the scenario_run_id from the span.
 *
 * Both are idempotent: the simulation fold's TraceMetrics map replaces
 * (not accumulates) per-trace entries, so duplicate dispatches converge
 * to the same final state.
 */
export function createSimulationMetricsSyncReactor(
  deps: SimulationMetricsSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "simulationMetricsSync",

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;
      const scenarioRunId = foldState.attributes["scenario.run_id"];

      if (!scenarioRunId) return;

      const roleCosts = foldState.scenarioRoleCosts ?? {};
      const roleLatencies = foldState.scenarioRoleLatencies ?? {};

      // Only dispatch if there's actual metric data
      if (Object.keys(roleCosts).length === 0 && foldState.totalCost === null) {
        return;
      }

      const traceId = foldState.traceId;

      logger.debug(
        { traceId, tenantId, scenarioRunId },
        "Propagating trace metrics to simulation run",
      );

      try {
        await deps.updateRunMetrics({
          tenantId,
          scenarioRunId,
          traceId,
          totalCost: foldState.totalCost ?? 0,
          roleCosts,
          roleLatencies,
          occurredAt: Date.now(),
        });
      } catch (error) {
        logger.warn(
          { traceId, tenantId, scenarioRunId, error },
          "Failed to dispatch updateRunMetrics from trace-side reactor",
        );
      }
    },
  };
}

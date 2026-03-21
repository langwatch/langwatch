import { createLogger } from "../../../../../utils/logger/server";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TraceProcessingEvent } from "../schemas/events";
import type { UpdateRunMetricsCommandData } from "../../simulation-processing/schemas/commands";

const logger = createLogger(
  "langwatch:trace-processing:simulation-metrics-sync-reactor",
);

export interface SimulationMetricsSyncReactorDeps {
  updateRunMetrics: (data: UpdateRunMetricsCommandData) => Promise<void>;
}

/**
 * Trace-side reactor: when a trace summary fold updates with scenario role data,
 * propagates per-trace cost/latency metrics to the simulation run.
 *
 * Zero queries — reads everything from the fold state context:
 * - roleCosts/roleLatencies from accumulated span data
 * - scenarioRunId from attributes["langwatch.scenario.run_id"]
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
      const { tenantId, aggregateId: traceId, foldState } = context;

      // Guard: only process traces with scenario role data
      const roleCosts = foldState.roleCosts ?? {};
      const roleLatencies = foldState.roleLatencies ?? {};
      if (Object.keys(roleCosts).length === 0 && Object.keys(roleLatencies).length === 0) {
        return;
      }

      // Guard: need scenarioRunId from trace attributes
      const attrs = foldState.attributes ?? {};
      const scenarioRunId = attrs["langwatch.scenario.run_id"];
      if (!scenarioRunId) {
        logger.debug(
          { traceId, tenantId },
          "Trace has scenario role data but no scenario.run_id attribute, skipping",
        );
        return;
      }

      logger.debug(
        { traceId, tenantId, scenarioRunId, roleCount: Object.keys(roleCosts).length },
        "Propagating trace metrics to simulation run",
      );

      await deps.updateRunMetrics({
        tenantId,
        scenarioRunId,
        traceId,
        totalCost: foldState.totalCost ?? 0,
        roleCosts,
        roleLatencies,
        occurredAt: Date.now(),
      });
    },
  };
}

import { createLogger } from "../../../../../utils/logger/server";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createTenantId } from "../../../domain/tenantId";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";
import {
  isSimulationTextMessageEndEvent,
  isSimulationMessageSnapshotEvent,
  isSimulationRunFinishedEvent,
} from "../schemas/typeGuards";
import type { UpdateRunMetricsCommandData } from "../schemas/commands";

const logger = createLogger(
  "langwatch:simulation-processing:trace-metrics-sync",
);

export interface TraceMetricsSyncReactorDeps {
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  updateRunMetrics: (data: UpdateRunMetricsCommandData) => Promise<void>;
}

/**
 * Simulation-side reactor: when a scenario message with trace_id arrives,
 * reads the trace summary and propagates per-role cost/latency metrics
 * to the simulation run.
 *
 * The trace summary fold accumulates roleCosts/roleLatencies by walking the
 * parent span chain (roles live on agent spans, costs on child LLM spans).
 * This reactor reads the completed summary and dispatches updateRunMetrics.
 */
export function createTraceMetricsSyncReactor(
  deps: TraceMetricsSyncReactorDeps,
): ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData> {
  return {
    name: "traceMetricsSync",

    async handle(
      event: SimulationProcessingEvent,
      context: ReactorContext<SimulationRunStateData>,
    ): Promise<void> {
      // Only fire on events that bring trace IDs
      if (
        !isSimulationTextMessageEndEvent(event) &&
        !isSimulationMessageSnapshotEvent(event) &&
        !isSimulationRunFinishedEvent(event)
      ) {
        return;
      }

      const { tenantId, foldState } = context;
      const traceIds = foldState.TraceIds;

      if (traceIds.length === 0) return;

      const scenarioRunId = foldState.ScenarioRunId;

      for (const traceId of traceIds) {
        // Skip traces we already have metrics for
        if (foldState.TraceMetrics[traceId]) continue;

        try {
          const traceSummary = await deps.traceSummaryStore.get(
            traceId,
            { tenantId: createTenantId(tenantId), aggregateId: traceId },
          );

          if (!traceSummary) {
            // Trace hasn't arrived yet — trace-side reactor will handle it
            continue;
          }

          const roleCosts = traceSummary.roleCosts ?? {};
          const roleLatencies = traceSummary.roleLatencies ?? {};

          // Only dispatch if there's actual metric data
          if (Object.keys(roleCosts).length === 0 && traceSummary.totalCost === null) {
            continue;
          }

          logger.debug(
            { traceId, tenantId, scenarioRunId },
            "Propagating trace metrics from trace summary to simulation run",
          );

          await deps.updateRunMetrics({
            tenantId,
            scenarioRunId,
            traceId,
            totalCost: traceSummary.totalCost ?? 0,
            roleCosts,
            roleLatencies,
            occurredAt: Date.now(),
          });
        } catch (error) {
          logger.warn(
            { traceId, tenantId, scenarioRunId, error },
            "Failed to read trace summary for metrics sync, skipping",
          );
        }
      }
    },
  };
}

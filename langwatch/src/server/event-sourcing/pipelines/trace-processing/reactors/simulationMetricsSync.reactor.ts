import { createLogger } from "../../../../../utils/logger/server";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TraceProcessingEvent } from "../schemas/events";
import type { ComputeRunMetricsCommandData } from "../../simulation-processing/schemas/commands";

const logger = createLogger(
  "langwatch:trace-processing:simulation-metrics-publisher",
);

export interface SimulationMetricsSyncReactorDeps {
  computeRunMetrics: (data: ComputeRunMetricsCommandData) => Promise<void>;
}

/**
 * Trace-side ECST publisher: when a simulation trace stabilises,
 * publishes its metrics to the simulation pipeline.
 *
 * Uses delay+dedup (60s) for terminal detection — fires once per trace
 * after 60s of quiet (no new spans). Carries the metrics data in the
 * command payload (Event-Carried State Transfer) so the simulation
 * pipeline doesn't need to query back.
 *
 * Scenario filtering: only fires for traces with scenario.run_id
 * in their hoisted span attributes.
 */
/**
 * Pure relevance guard, shared by shouldReact (pre-enqueue) and handle
 * (fail-open path): only simulation traces (scenario.run_id present)
 * with something to aggregate need this reactor.
 */
function hasSimulationMetrics(foldState: TraceSummaryData): boolean {
  if (!foldState.attributes["scenario.run_id"]) return false;
  return !(foldState.spanCount === 0 && foldState.totalCost === null);
}

export function createSimulationMetricsSyncReactor(
  deps: SimulationMetricsSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "simulationMetricsSync",
    shouldReact: (_event, context) => hasSimulationMetrics(context.foldState),
    options: {
      makeJobId: (payload) =>
        `sim-metrics:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 60_000,
      delay: 60_000,
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;
      if (!hasSimulationMetrics(foldState)) return;

      // Role cost/latency are no longer accumulated on the fold;
      // computeRunMetrics derives them per-trace from stored_spans, so we
      // dispatch in pull mode rather than carrying metrics.
      const scenarioRunId = foldState.attributes["scenario.run_id"]!;

      const traceId = foldState.traceId;

      logger.debug(
        { traceId, tenantId, scenarioRunId },
        "Publishing trace metrics to simulation run (derived on compute)",
      );

      try {
        await deps.computeRunMetrics({
          tenantId,
          scenarioRunId,
          traceId,
          retryCount: 0,
          occurredAt: Date.now(),
        });
      } catch (error) {
        logger.warn(
          { traceId, tenantId, scenarioRunId, error },
          "Failed to dispatch computeRunMetrics from trace-side reactor",
        );
      }
    },
  };
}

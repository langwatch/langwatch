import type { AppendStore } from "@langwatch/eventing";
import { AbstractMapProjection, type MapEventHandlers } from "@langwatch/eventing";
import { SIMULATION_PROJECTION_VERSIONS } from "../adapters/simulation-run.adapter";
import {
  type SimulationRunMetricsComputedEvent,
  SimulationRunMetricsComputedEventSchema,
} from "../adapters/simulation-run.adapter";

/**
 * Row shape of the `simulation_run_metrics` ClickHouse table (migration
 * 00078). Field names match the CH columns 1:1; `OccurredAt` is Unix ms on
 * the record and is written as DateTime64(3) by the repository.
 */
export interface SimulationRunMetricsProjectionRecord {
  TenantId: string;
  ScenarioRunId: string;
  TraceId: string;
  TotalCost: number;
  RoleCosts: Record<string, number>;
  RoleLatencies: Record<string, number>;
  OccurredAt: number;
  EventId: string;
}

const metricsEvents = [SimulationRunMetricsComputedEventSchema] as const;

/**
 * One `simulation_run_metrics` ClickHouse row per metrics_computed event.
 * This projection is a pure map: metrics are already computed upstream
 * (ComputeRunMetricsCommand) and carried on the event via ECST, so it never
 * reads a prior row or projection. Retry re-deliveries are collapsed by the
 * dedupe-safe rollup (simulation_run_metrics_rollup, migration 00079) and at
 * read time via argMaxMerge per trace.
 */
export class SimulationRunMetricsMapProjection
  extends AbstractMapProjection<SimulationRunMetricsProjectionRecord, typeof metricsEvents>
  implements MapEventHandlers<typeof metricsEvents, SimulationRunMetricsProjectionRecord>
{
  readonly name = "simulationRunMetrics";
  readonly version = SIMULATION_PROJECTION_VERSIONS.RUN_METRICS;
  readonly store: AppendStore<SimulationRunMetricsProjectionRecord>;

  protected readonly events = metricsEvents;

  constructor(deps: { store: AppendStore<SimulationRunMetricsProjectionRecord> }) {
    super();
    this.store = deps.store;
  }

  mapSimulationRunMetricsComputed(
    event: SimulationRunMetricsComputedEvent,
  ): SimulationRunMetricsProjectionRecord {
    return {
      TenantId: String(event.tenantId),
      ScenarioRunId: event.data.scenarioRunId,
      TraceId: event.data.traceId,
      TotalCost: event.data.totalCost,
      RoleCosts: event.data.roleCosts,
      RoleLatencies: event.data.roleLatencies,
      OccurredAt: event.occurredAt,
      EventId: event.id,
    };
  }
}

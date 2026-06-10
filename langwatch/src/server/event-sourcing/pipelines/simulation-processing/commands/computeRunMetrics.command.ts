import type {
  Command,
  CommandHandler,
} from "../../../";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createLogger } from "../../../../../utils/logger/server";
import type { ComputeRunMetricsCommandData } from "../schemas/commands";
import { computeRunMetricsCommandDataSchema } from "../schemas/commands";
import {
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunMetricsComputedEvent,
  SimulationRunMetricsComputedEventData,
} from "../schemas/events";

const logger = createLogger(
  "langwatch:simulation-processing:compute-run-metrics",
);

const MAX_RETRIES = 3;
export const COMPUTE_METRICS_RETRY_DELAY_MS = 10_000;

export interface ComputeRunMetricsDeps {
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  scheduleRetry: (payload: ComputeRunMetricsCommandData) => Promise<void>;
  /**
   * Derives per-role cost/latency for a trace from stored_spans. Replaces the
   * old per-span fold accumulation: role costs are no longer carried on the
   * trace summary, so they are computed here (once per trace, when its metrics
   * are needed) instead of on the hot fold path for every span of every trace.
   */
  deriveScenarioRoleMetrics: (params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }) => Promise<{
    scenarioRoleCosts: Record<string, number>;
    scenarioRoleLatencies: Record<string, number>;
  }>;
}

const SCHEMA = defineCommandSchema(
  SIMULATION_RUN_COMMAND_TYPES.COMPUTE_METRICS,
  computeRunMetricsCommandDataSchema,
  "Command to compute simulation run cost/latency metrics from trace data",
);

/**
 * Command handler for computing simulation run metrics.
 *
 * Supports two modes:
 * 1. ECST mode: metrics provided in payload (from trace-side reactor) - emits event directly
 * 2. Pull mode: no metrics in payload (from simulation-side reactor) - reads trace summary
 *
 * When a trace summary is not yet available, schedules a deferred retry.
 *
 * Uses constructor DI — instantiate with deps and pass via `.withCommandInstance()`.
 */
export class ComputeRunMetricsCommand
  implements
    CommandHandler<
      Command<ComputeRunMetricsCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = SCHEMA;

  constructor(private readonly deps: ComputeRunMetricsDeps) {}

  async handle(
    command: Command<ComputeRunMetricsCommandData>,
  ): Promise<SimulationProcessingEvent[]> {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { scenarioRunId, traceId } = data;

    logger.debug(
      { tenantId, scenarioRunId, traceId, hasMetrics: !!data.metrics, retryCount: data.retryCount },
      "Handling compute run metrics command",
    );

    // ECST path: metrics provided in payload
    let metrics = data.metrics;

    // Pull fallback: read from trace summary store
    if (!metrics) {
      const traceSummary = await this.deps.traceSummaryStore.get(traceId, {
        tenantId,
        aggregateId: traceId,
      });

      if (!traceSummary) {
        logger.debug(
          { tenantId, scenarioRunId, traceId, retryCount: data.retryCount },
          "Trace summary not available yet",
        );

        if (data.retryCount < MAX_RETRIES) {
          await this.deps.scheduleRetry({
            ...data,
            retryCount: data.retryCount + 1,
            occurredAt: Date.now(),
          });
        } else {
          logger.warn(
            { tenantId, scenarioRunId, traceId },
            "Max retries reached for trace metrics computation, giving up",
          );
        }

        return [];
      }

      // Role cost/latency are derived from stored_spans (not carried on the
      // summary anymore); totalCost is still a summary scalar.
      const { scenarioRoleCosts: roleCosts, scenarioRoleLatencies: roleLatencies } =
        await this.deps.deriveScenarioRoleMetrics({
          tenantId: tenantIdStr,
          traceId,
          occurredAtMs: traceSummary.occurredAt,
          foldVersion: traceSummary.spanCount,
        });

      // Summary exists but not yet populated (cost enrichment still in progress).
      // Treat like missing summary — schedule retry so we pick it up later.
      // Role latency is enough on its own: a scenario trace can have
      // role-bearing spans with latency but no cost (totalCost null, roleCosts
      // empty), and those metrics are still worth emitting.
      if (
        Object.keys(roleCosts).length === 0 &&
        Object.keys(roleLatencies).length === 0 &&
        traceSummary.totalCost === null
      ) {
        logger.debug(
          { tenantId, scenarioRunId, traceId, retryCount: data.retryCount },
          "Trace summary exists but has no metrics yet",
        );

        if (data.retryCount < MAX_RETRIES) {
          await this.deps.scheduleRetry({
            ...data,
            retryCount: data.retryCount + 1,
            occurredAt: Date.now(),
          });
        } else {
          logger.warn(
            { tenantId, scenarioRunId, traceId },
            "Max retries reached for trace metrics (summary empty), giving up",
          );
        }

        return [];
      }

      metrics = {
        totalCost: traceSummary.totalCost ?? 0,
        roleCosts,
        roleLatencies,
      };
    }

    const eventData: SimulationRunMetricsComputedEventData = {
      scenarioRunId,
      traceId,
      totalCost: metrics.totalCost,
      roleCosts: metrics.roleCosts,
      roleLatencies: metrics.roleLatencies,
    };

    const event = EventUtils.createEvent<SimulationRunMetricsComputedEvent>({
      aggregateType: "simulation_run",
      aggregateId: scenarioRunId,
      tenantId,
      type: SIMULATION_RUN_EVENT_TYPES.METRICS_COMPUTED,
      version: SIMULATION_EVENT_VERSIONS.METRICS_COMPUTED,
      data: eventData,
      occurredAt: data.occurredAt,
      idempotencyKey: `${tenantIdStr}:${scenarioRunId}:${traceId}:computeRunMetrics`,
    });

    logger.debug(
      { tenantId, scenarioRunId, traceId, eventId: event.id },
      "Emitting simulation run metrics computed event",
    );

    return [event];
  }

  static getAggregateId(payload: ComputeRunMetricsCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: ComputeRunMetricsCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.traceId": payload.traceId,
      "payload.hasMetrics": !!payload.metrics,
      "payload.retryCount": payload.retryCount,
    };
  }

  static makeJobId(payload: ComputeRunMetricsCommandData): string {
    return `${payload.tenantId}:${payload.scenarioRunId}:${payload.traceId}:compute-run-metrics`;
  }
}


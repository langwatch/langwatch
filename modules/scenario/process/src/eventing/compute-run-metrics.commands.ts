import type { Command, CommandHandler, FoldProjectionStore } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
  computeRunMetricsCommandDataSchema,
  type ComputeRunMetricsCommandData,
  type SimulationProcessingEvent,
  type SimulationRunMetricsComputedEvent,
  type SimulationRunMetricsComputedEventData,
} from "@langwatch/scenario-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";

const logger = createLogger("langwatch:simulation-processing:compute-run-metrics");

const MAX_RETRIES = 3;
export const COMPUTE_METRICS_RETRY_DELAY_MS = 10_000;

/**
 * Retry scheduling for deferred compute-run-metrics job: registered after
 * pipeline (not in definition), decided beside handler and read by service.
 */
export const scenarioDeferredComputeRunMetricsJob = {
  name: "deferredComputeRunMetrics",
  delayMs: COMPUTE_METRICS_RETRY_DELAY_MS,
  /**
   * A run that is still waiting on its trace summary reschedules on every
   * attempt, so the id has to collapse those onto one queue entry rather than
   * accumulate one per attempt — `retryCount` is deliberately absent from it.
   */
  makeJobId(payload: ComputeRunMetricsCommandData): string {
    return `compute-metrics-retry:${payload.tenantId}:${payload.scenarioRunId}:${payload.traceId}`;
  },
  spanAttributes(payload: ComputeRunMetricsCommandData): Record<string, string | number | boolean> {
    return {
      "deferred.tenant_id": payload.tenantId,
      "deferred.scenario_run_id": payload.scenarioRunId,
      "deferred.trace_id": payload.traceId,
      "deferred.retry_count": payload.retryCount,
    };
  },
};

export interface ComputeRunMetricsDeps {
  traceSummaryStore: Pick<FoldProjectionStore<TraceSummaryData>, "get">;
  scheduleRetry: (payload: ComputeRunMetricsCommandData) => Promise<void>;
  /**
   * Derives per-role cost/latency for a trace from stored_spans, replacing
   * per-span fold accumulation: computed once per trace when metrics are
   * needed, instead of on the hot fold path for every span.
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
 * Handler for computing simulation run metrics: ECST (payload) and Pull
 * (trace summary) modes; schedules retry if summary unavailable; carries
 * occurredAt through retries as partition key.
 */
export class ComputeRunMetricsAdapter implements CommandHandler<
  Command<ComputeRunMetricsCommandData>,
  SimulationProcessingEvent
> {
  static readonly schema = SCHEMA;

  static create(deps: ComputeRunMetricsDeps): ComputeRunMetricsAdapter {
    return new ComputeRunMetricsAdapter(deps);
  }

  constructor(private readonly deps: ComputeRunMetricsDeps) {}

  async handle(
    command: Command<ComputeRunMetricsCommandData>,
  ): Promise<SimulationProcessingEvent[]> {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { scenarioRunId, traceId } = data;

    logger.debug(
      {
        tenantId,
        scenarioRunId,
        traceId,
        hasMetrics: !!data.metrics,
        retryCount: data.retryCount,
      },
      "Handling compute run metrics command",
    );

    // ECST path: metrics provided in payload
    let metrics = data.metrics;

    // Pull fallback: read from trace summary store
    if (!metrics) {
      const summaryRead = await this.deps.traceSummaryStore.get(traceId, {
        tenantId,
        aggregateId: traceId,
      });

      if (summaryRead.kind === "empty") {
        logger.debug(
          { tenantId, scenarioRunId, traceId, retryCount: data.retryCount },
          "Trace summary not available yet",
        );

        if (data.retryCount < MAX_RETRIES) {
          await this.deps.scheduleRetry({
            ...data,
            retryCount: data.retryCount + 1,
          });
        } else {
          // Error, not warn: giving up here means this run's cost and
          // latency never exist, with no later event to repair it. Logged
          // with the waited window, since "too slow" and "never arrived" differ.
          logger.error(
            {
              tenantId,
              scenarioRunId,
              traceId,
              attempts: MAX_RETRIES,
              waitedMs: MAX_RETRIES * COMPUTE_METRICS_RETRY_DELAY_MS,
            },
            "Gave up computing trace metrics: the trace summary never arrived, so this run has no cost or latency",
          );
        }

        return [];
      }
      const traceSummary = summaryRead.state;

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
          });
        } else {
          logger.error(
            {
              tenantId,
              scenarioRunId,
              traceId,
              attempts: MAX_RETRIES,
              waitedMs: MAX_RETRIES * COMPUTE_METRICS_RETRY_DELAY_MS,
            },
            "Gave up computing trace metrics: the trace summary stayed empty, so this run has no cost or latency",
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

export { ComputeRunMetricsAdapter as ComputeRunMetricsCommand };

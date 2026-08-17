import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { Command, CommandHandler } from "../../../";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ComputeRunMetricsCommandData } from "../schemas/commands";
import { computeRunMetricsCommandDataSchema } from "../schemas/commands";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_COMMAND_TYPES,
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

/**
 * The pull ladder's total budget must outlast the trace-side publisher's
 * settle debounce, or it is guaranteed to lose a race it is meant to win.
 *
 * The trace side (simulationMetricsSync.subscriber, SIMULATION_METRICS_SYNC_DELAY_MS)
 * waits 60s of quiet on a trace before publishing its metrics. This ladder used
 * to give up after 3 × 10s = 30s, i.e. always before the trace side had even
 * been allowed to fire, and then logged an error saying the run would never
 * have cost or latency. It usually did, moments later, from the other path — so
 * the loudest line in this file was, structurally, almost always wrong.
 *
 * Kept comfortably past the debounce so a genuine give-up means something.
 */
const MAX_RETRIES = 9;
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
 * 1. ECST mode: metrics provided in payload (from trace-side subscriber) - emits event directly
 * 2. Pull mode: no metrics in payload (from simulation-side subscriber) - reads trace summary
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
          // Still an error, and the only one left in this file: a simulation
          // run whose trace never produced a summary at all is a genuine
          // anomaly, distinct from the branch below where the summary exists
          // and honestly reports no cost. Logged with the window actually
          // waited, because "the trace was slower than the budget" and "the
          // trace never arrived" need different responses.
          //
          // The trace-side publisher can still repair this if the trace shows
          // up later (simulationMetricsSync.subscriber dispatches on settle),
          // so this is not necessarily terminal — but nothing schedules
          // another attempt from here.
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

      // Role cost/latency are derived from stored_spans (not carried on the
      // summary anymore); totalCost is still a summary scalar.
      const {
        scenarioRoleCosts: roleCosts,
        scenarioRoleLatencies: roleLatencies,
      } = await this.deps.deriveScenarioRoleMetrics({
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
          return [];
        }

        // Not a failure, and no longer logged as one. A simulation trace can
        // legitimately carry spans that have no cost and no role timing at all
        // — an SDK-driven run whose agent executes on the customer's own
        // infrastructure and never reports LLM spans to us is the common case,
        // and no amount of waiting will conjure a cost that was never sent.
        // Retrying to exhaustion and then logging an error taught us nothing
        // and fired ~122 times a day.
        //
        // Falling through emits the event with what the trace actually has,
        // which for this branch is zero cost and no role timing. That records
        // "this run has no cost" as a fact instead of leaving the run
        // indistinguishable from one whose metrics we lost. The fold reports
        // TotalCost as null when the total is zero, so a costless run still
        // renders as "no cost" rather than a misleading $0.00.
        logger.info(
          {
            tenantId,
            scenarioRunId,
            traceId,
            attempts: MAX_RETRIES,
            waitedMs: MAX_RETRIES * COMPUTE_METRICS_RETRY_DELAY_MS,
          },
          "Trace reported no cost or role timing; recording the run as costless",
        );
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

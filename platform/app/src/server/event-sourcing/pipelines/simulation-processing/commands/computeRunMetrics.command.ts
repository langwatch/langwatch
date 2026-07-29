import { createHash } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { Command, CommandHandler } from "../../../";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { ComputeRunMetricsCommandData } from "../schemas/commands";
import { computeRunMetricsCommandDataSchema } from "../schemas/commands";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunMetricsRecordedEvent,
  SimulationRunMetricsRecordedEventData,
} from "../schemas/events";

const logger = createLogger(
  "langwatch:simulation-processing:compute-run-metrics",
);

/**
 * Cost is summed across traces before being written, so it is rounded once,
 * here, rather than repeatedly by whoever reads it. Six places is below a
 * hundredth of a cent — finer than any price we bill at, coarse enough to keep
 * float noise out of the stored value.
 */
const COST_DECIMAL_PLACES = 6;

export interface ComputeRunMetricsDeps {
  /**
   * The run's own fold, read for the traces to aggregate over. Read here rather
   * than carried on the payload so nothing upstream has to accumulate trace ids,
   * and so a trace that landed after the run finished is still measured.
   */
  simulationRunStore: FoldProjectionStore<SimulationRunStateData>;
  /** The trace pipeline's summary fold — read for each trace's `totalCost`. */
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /**
   * Derives per-role cost/latency for a trace from its stored spans. Role cost
   * and latency are not carried on the trace summary — they would grow the hot
   * fold path with span count — so they are derived once here, when the run's
   * metrics are computed.
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
  "Command to compute a simulation run's cost/latency from all of its traces",
);

/** One trace's contribution to the run, in the shape the aggregate needs. */
interface TraceContribution {
  totalCost: number | null;
  roleCosts: Record<string, number>;
  roleLatencies: Record<string, number>;
}

/**
 * Fingerprint of the computed values, used to key the emitted event.
 *
 * The point is convergence. A key that ignores the values — as the per-trace
 * predecessor's did — means the event store's keep-the-first rule discards every
 * later, better answer, so a run measured before its spans landed stays wrong
 * forever. Keyed on the values instead, a repeat of the SAME answer still
 * collapses (the property idempotency is for) while a DIFFERENT answer is a
 * different event and lands.
 *
 * Keys are sorted so two objects that differ only in insertion order fingerprint
 * alike.
 */
function fingerprintMetrics(
  data: SimulationRunMetricsRecordedEventData,
): string {
  const canonicalRoles = (roles: Record<string, number[]>) =>
    Object.keys(roles)
      .sort()
      .map((role) => [role, roles[role]] as const);

  return createHash("sha256")
    .update(
      JSON.stringify([
        [...data.traceIds].sort(),
        data.totalCost,
        canonicalRoles(data.roleCosts),
        canonicalRoles(data.roleLatencies),
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * Computes a finished simulation run's cost and latency from every trace it
 * produced, and emits ONE event carrying the result.
 *
 * Why an event carrying values rather than a read-time join: `stored_spans` and
 * `trace_summaries` are in the `traces` retention category while
 * `simulation_runs` is in `scenarios`, and the two are configured
 * independently. Deriving at read time would blank a still-visible run's metrics
 * the moment its spans aged out. An event carrying the numbers replays without
 * spans.
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
    const { scenarioRunId } = data;

    const run = await this.deps.simulationRunStore.get(scenarioRunId, {
      tenantId,
      aggregateId: scenarioRunId,
    });

    if (!run) {
      logger.warn(
        { tenantId, scenarioRunId },
        "No stored run to measure — nothing has been folded for it",
      );
      return [];
    }

    // Re-checked here rather than only where the measurement was asked for: the
    // settle period gives a user a full minute to delete the run, and measuring
    // it would spend reads and write cost onto a row nobody can open.
    if (run.ArchivedAt != null) {
      logger.debug(
        { tenantId, scenarioRunId },
        "Run was deleted before it could be measured",
      );
      return [];
    }

    const traceIds = run.TraceIds;
    if (traceIds.length === 0) {
      logger.debug(
        { tenantId, scenarioRunId },
        "Run has no traces, nothing to measure",
      );
      return [];
    }

    // Reads run concurrently and the results stay positionally aligned with
    // `traceIds`, so the aggregate below is order-deterministic regardless of
    // which read finishes first. A read that throws fails the command, so the
    // queue retries it — the predecessor logged and dropped, which is how a
    // finished run silently ended up with no cost at all.
    const contributions = await Promise.all(
      traceIds.map((traceId) => this.measureTrace({ tenantIdStr, traceId })),
    );

    let costTotal = 0;
    const roleCosts: Record<string, number[]> = {};
    const roleLatencies: Record<string, number[]> = {};

    for (const contribution of contributions) {
      costTotal += contribution.totalCost ?? 0;
      for (const [role, cost] of Object.entries(contribution.roleCosts)) {
        (roleCosts[role] ??= []).push(cost);
      }
      for (const [role, latency] of Object.entries(
        contribution.roleLatencies,
      )) {
        (roleLatencies[role] ??= []).push(latency);
      }
    }

    const hasRoleMetrics =
      Object.keys(roleCosts).length > 0 ||
      Object.keys(roleLatencies).length > 0;

    // Nothing measurable came back: no trace reported a cost and no span carried
    // a scenario role. Writing that would overwrite whatever the run already
    // shows with a row of blanks, so it is left alone and logged instead.
    //
    // Recording no event is also the signal the `runMetrics` process reads: the
    // absence of a `metrics_recorded` event is what leaves its re-measure
    // standing, so a run measured before its cost enrichment landed is asked
    // for again rather than left unpriced.
    if (costTotal <= 0 && !hasRoleMetrics) {
      logger.warn(
        { tenantId, scenarioRunId, traceCount: traceIds.length },
        "No cost or role metrics found for the run's traces, leaving metrics unchanged",
      );
      return [];
    }

    const eventData: SimulationRunMetricsRecordedEventData = {
      scenarioRunId,
      traceIds,
      // Zero collapses to null, as it did when the fold aggregated per trace: a
      // run that cost nothing measurable and one that was never priced are the
      // same "no cost to show" to every reader downstream.
      totalCost:
        costTotal > 0 ? Number(costTotal.toFixed(COST_DECIMAL_PLACES)) : null,
      roleCosts,
      roleLatencies,
    };

    const event = EventUtils.createEvent<SimulationRunMetricsRecordedEvent>({
      aggregateType: "simulation_run",
      aggregateId: scenarioRunId,
      tenantId,
      type: SIMULATION_RUN_EVENT_TYPES.METRICS_RECORDED,
      version: SIMULATION_EVENT_VERSIONS.METRICS_RECORDED,
      data: eventData,
      occurredAt: data.occurredAt,
      idempotencyKey: `${tenantIdStr}:${scenarioRunId}:runMetrics:${fingerprintMetrics(eventData)}`,
    });

    logger.debug(
      {
        tenantId,
        scenarioRunId,
        eventId: event.id,
        traceCount: traceIds.length,
        totalCost: eventData.totalCost,
      },
      "Emitting simulation run metrics recorded event",
    );

    return [event];
  }

  private async measureTrace({
    tenantIdStr,
    traceId,
  }: {
    tenantIdStr: string;
    traceId: string;
  }): Promise<TraceContribution> {
    const summary = await this.deps.traceSummaryStore.get(traceId, {
      tenantId: createTenantId(tenantIdStr),
      aggregateId: traceId,
    });

    // `occurredAtMs` prunes ClickHouse partitions and `foldVersion` keys the
    // derivation memo; both are hints, so a trace with no summary yet is still
    // read — its spans may be stored even when its summary fold has not landed.
    const { scenarioRoleCosts, scenarioRoleLatencies } =
      await this.deps.deriveScenarioRoleMetrics({
        tenantId: tenantIdStr,
        traceId,
        occurredAtMs: summary?.occurredAt,
        foldVersion: summary?.spanCount,
      });

    return {
      totalCost: summary?.totalCost ?? null,
      roleCosts: scenarioRoleCosts,
      roleLatencies: scenarioRoleLatencies,
    };
  }

  static getAggregateId(payload: ComputeRunMetricsCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: ComputeRunMetricsCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenarioRun.id": payload.scenarioRunId,
    };
  }
}

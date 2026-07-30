import { renderGroupKey } from "../dispatch/groupKey";
import { ConfigurationError, UndecodableStateError } from "../errors";
import type { WireEvent } from "../pipeline/pipeline.types";
import type { Metrics } from "../ports/metrics";
import { noopMetrics } from "../ports/metrics";
import type {
  CommittedEvent,
  EventLog,
  Registry,
  ReplayReport,
  ReplayRequest,
} from "./contracts";

/**
 * Replay (ADR-108 decision 12): the sole bulk reader of event_log, re-running
 * the same fold and map executors the delivery path uses. It never runs
 * subscribers or process managers — both do work that must not be re-fired
 * for history that already happened live — and it is gated on a fold's state
 * version, so a row this build cannot decode is skipped rather than
 * overwritten.
 */

export interface ReplayDeps {
  readonly eventLog: EventLog;
  /** Only `all()` is needed — replay reads the registered pipelines, it does
   * not resolve commands or subscribers. */
  readonly registry: Pick<Registry, "all">;
  readonly metrics?: Metrics;
}

function toWireEvent(committed: CommittedEvent): WireEvent {
  return { type: committed.eventType, data: JSON.parse(committed.payload) };
}

function selected(
  available: readonly string[],
  requested: readonly string[] | undefined,
): readonly string[] {
  return requested === undefined
    ? available
    : available.filter((name) => requested.includes(name));
}

export function createReplay(
  deps: ReplayDeps,
): (request: ReplayRequest) => Promise<ReplayReport> {
  const metrics = deps.metrics ?? noopMetrics;
  const outcomes = metrics.counter({
    name: "es_replay_outcomes_total",
    help: "Replay outcomes, by lane and outcome.",
    labelNames: ["lane", "outcome"],
  });

  return async function replay(request: ReplayRequest): Promise<ReplayReport> {
    const registered = deps.registry
      .all()
      .find((entry) => entry.aggregateType === request.aggregateType);
    if (!registered) {
      throw new ConfigurationError(
        `no registered pipeline owns aggregate type "${request.aggregateType}"`,
        { aggregateType: request.aggregateType },
      );
    }
    const pipeline = registered.pipeline;

    const foldNames = selected(
      Object.keys(pipeline.folds),
      request.projections,
    );
    const mapNames = selected(Object.keys(pipeline.maps), request.projections);

    let scanned = 0;
    const allEvents: WireEvent[] = [];
    const byAggregate = new Map<string, WireEvent[]>();

    for await (const committed of deps.eventLog.scan({
      tenantId: request.tenantId,
      aggregateType: request.aggregateType,
      aggregateId: request.aggregateId,
      occurredFrom: request.occurredFrom,
      occurredTo: request.occurredTo,
    })) {
      scanned += 1;
      const wire = toWireEvent(committed);
      allEvents.push(wire);
      const bucket = byAggregate.get(committed.aggregateId);
      if (bucket) bucket.push(wire);
      else byAggregate.set(committed.aggregateId, [wire]);
    }

    let applied = 0;
    let skippedByVersion = 0;

    // A map has no accumulator, so the whole scanned range is one delivery —
    // one batched write regardless of how many aggregates it spans.
    for (const name of mapNames) {
      const map = pipeline.maps[name]!;
      const lane = renderGroupKey({
        tenantId: request.tenantId,
        lane: { kind: "map", name },
        scope: { kind: "global" },
      });
      const { written } = await map.apply({
        tenantId: request.tenantId,
        events: allEvents,
      });
      applied += written;
      outcomes.inc({ lane, outcome: "applied" }, written);
    }

    // A fold reads its own row back, so it is delivered per aggregate — and
    // gated: a row this build cannot decode is skipped, never overwritten.
    for (const name of foldNames) {
      const fold = pipeline.folds[name]!;
      for (const [aggregateId, events] of byAggregate) {
        const lane = renderGroupKey({
          tenantId: request.tenantId,
          lane: { kind: "fold", name },
          scope: {
            kind: "aggregate",
            aggregateType: request.aggregateType,
            aggregateId,
          },
        });
        try {
          const { events: appliedCount } = await fold.apply({
            key: aggregateId,
            tenantId: request.tenantId,
            events,
          });
          applied += appliedCount;
          outcomes.inc({ lane, outcome: "applied" }, appliedCount);
        } catch (error) {
          if (!(error instanceof UndecodableStateError)) throw error;
          skippedByVersion += 1;
          outcomes.inc({ lane, outcome: "skippedByVersion" });
        }
      }
    }

    return { events: scanned, applied, skippedByVersion };
  };
}

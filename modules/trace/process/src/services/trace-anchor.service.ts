import type { Authorization, AuthorizationPurpose } from "@langwatch/authorization";

import type { TraceAnalyticsProjectionRepository } from "../repositories/trace-analytics-projection.repository.ts";
import { WIDGET_COLUMNS_REPLAY_HOURS } from "../rules/trace-widget-columns.rules.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How far before an evaluation its trace is first looked for; past it, one read of the reach. */
const TRACE_LOOKBACK_MS = 35 * DAY_MS;

/** The furthest an anchor is looked for: the stock widgets' reach, past which no row is read. */
const TRACE_REACH_MS = WIDGET_COLUMNS_REPLAY_HOURS * HOUR_MS;

/** How far after the evaluation: a trace's anchor never follows its evaluation by more. */
const TRACE_LOOKAHEAD_MS = DAY_MS;

type TraceAnchorDependencies = Readonly<{
  traces: Pick<TraceAnalyticsProjectionRepository, "findOccurredAtByTraceIds">;
  authorize: (input: {
    projectId: string;
    purpose: AuthorizationPurpose;
  }) => Promise<Authorization>;
}>;

/**
 * Each trace's OccurredAt, the anchor an outcome recorded on it carries, for the live recorder
 * and the backfill alike (trace ADR-003).
 */
export class TraceAnchorService {
  private constructor(private readonly deps: TraceAnchorDependencies) {}

  static create(deps: TraceAnchorDependencies): TraceAnchorService {
    return new TraceAnchorService(deps);
  }

  /**
   * One read near the hinted evaluation times, then one read of the older reach for every trace
   * it missed. A trace found by neither is left out, and the caller skips its outcome.
   */
  async traceAnchors({
    tenantId,
    traces,
    purpose,
  }: {
    tenantId: string;
    traces: readonly { traceId: string; nearMs: number }[];
    purpose: AuthorizationPurpose;
  }): Promise<Map<string, number>> {
    if (traces.length === 0) return new Map();
    const authorization = await this.deps.authorize({ projectId: tenantId, purpose });
    const nearest = traces.map(({ nearMs }) => nearMs);
    const earliestMs = Math.min(...nearest);
    const found = await this.deps.traces.findOccurredAtByTraceIds({
      authorization,
      traceIds: traces.map(({ traceId }) => traceId),
      window: {
        fromMs: earliestMs - TRACE_LOOKBACK_MS,
        toMs: Math.max(...nearest) + TRACE_LOOKAHEAD_MS,
      },
    });
    const anchors = new Map(found.map(({ traceId, occurredAtMs }) => [traceId, occurredAtMs]));
    const missed = [...new Set(traces.map(({ traceId }) => traceId))].filter(
      (traceId) => !anchors.has(traceId),
    );
    if (missed.length === 0) return anchors;
    const older = await this.deps.traces.findOccurredAtByTraceIds({
      authorization,
      traceIds: missed,
      window: { fromMs: earliestMs - TRACE_REACH_MS, toMs: earliestMs - TRACE_LOOKBACK_MS },
    });
    for (const { traceId, occurredAtMs } of older) anchors.set(traceId, occurredAtMs);
    return anchors;
  }
}

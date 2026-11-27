import {
  isTraceWithheld,
  type Protections,
  TraceWithheldOverPlanError,
  type TraceWithholding,
  traceWithholdingOf,
} from "@langwatch/trace-contract";

/**
 * The range ended just before the over-plan cutoff (list reads are `OccurredAt <= to`), so a read
 * under it never returns a withheld trace (specs/billing/over-plan-trace-withholding.feature).
 * A clamped range is never `live`: a live window skips the upper bound.
 */
export function clampToWithheld<T extends { from: number; to: number; live?: boolean }>({
  timeRange,
  withholding,
}: {
  timeRange: T;
  withholding: TraceWithholding | undefined;
}): T {
  if (withholding?.kind !== "over_plan") return timeRange;
  const to = Math.min(timeRange.to, withholding.fromMs - 1);
  return {
    ...timeRange,
    from: Math.min(timeRange.from, to),
    to,
    ...(timeRange.live === undefined ? {} : { live: false }),
  };
}

/** A legacy search's `endDate` ended before the over-plan cutoff; empty when nothing is held. */
export function withheldEndDate({
  query,
  protections,
}: {
  query: { endDate?: number | undefined };
  /** The legacy list input carries its protections untyped; every field is optional. */
  protections: unknown;
}): { endDate?: number } {
  const withholding = isProtections(protections) ? traceWithholdingOf(protections) : undefined;
  if (withholding?.kind !== "over_plan") return {};
  const cutoffEnd = withholding.fromMs - 1;
  return { endDate: query.endDate === undefined ? cutoffEnd : Math.min(query.endDate, cutoffEnd) };
}

function isProtections(value: unknown): value is Protections {
  return typeof value === "object" && value !== null;
}

/** Throws `trace_withheld_over_plan` for a loaded trace the viewer's plan withholds. */
export function refuseWithheldTrace({
  trace,
  protections,
}: {
  trace: { trace_id: string; timestamps?: { started_at?: number | null } | null };
  protections: Protections;
}): void {
  const withholding = traceWithholdingOf(protections);
  const startedAtMs = trace.timestamps?.started_at;
  if (withholding.kind !== "over_plan" || startedAtMs === null || startedAtMs === undefined) return;
  if (isTraceWithheld({ startedAtMs, withheldFromMs: withholding.fromMs })) {
    throw new TraceWithheldOverPlanError({
      traceId: trace.trace_id,
      members: withholding.members,
      maxMembers: withholding.maxMembers,
    });
  }
}

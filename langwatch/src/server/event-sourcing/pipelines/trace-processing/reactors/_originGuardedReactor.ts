import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const OLD_TRACE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Defines a trace-processing reactor that fires only when:
 *   1. the event is recent (<1h old, skips replay/resync floods),
 *   2. the trace is not blocked by guardrail with no output, and
 *   3. `langwatch.origin` is resolved on the fold state.
 *
 * The originGate reactor handles deferred resolution for traces that
 * arrive without a resolved origin, so other origin-dependent reactors
 * just no-op until the gate has fired.
 *
 * Wraps the reactor's `handle` with these guards so each call site
 * doesn't repeat the same five-line preamble.
 */
export function defineOriginGuardedTraceReactor(opts: {
  name: string;
  jobIdPrefix: string;
  ttl?: number;
  delay?: number;
  handle: (
    event: TraceProcessingEvent,
    context: ReactorContext<TraceSummaryData>,
  ) => Promise<void>;
}): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: opts.name,
    options: {
      makeJobId: (payload) =>
        `${opts.jobIdPrefix}:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: opts.ttl ?? 30_000,
      delay: opts.delay ?? 30_000,
    },

    async handle(event, context) {
      if (event.occurredAt < Date.now() - OLD_TRACE_THRESHOLD_MS) return;

      const { foldState } = context;
      if (foldState.blockedByGuardrail && !foldState.computedOutput) return;

      const attrs = foldState.attributes ?? {};
      if (!attrs["langwatch.origin"]) return;

      await opts.handle(event, context);
    },
  };
}

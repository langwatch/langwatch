/**
 * `@langwatch/event-sourcing` — the event-sourcing core.
 *
 * The package holds the substrate: aggregate definitions, projection
 * execution, the dispatch-plane group key, and the projection store contracts.
 * Pipelines and the composition root stay in the application, because a
 * pipeline is domain code and the composition root is where infrastructure is
 * resolved (ADR-102).
 *
 * Observability is house infrastructure, not a reinvention: logging comes from
 * `@langwatch/observability`, tracing from the OpenTelemetry API. Metrics is
 * the one port, because there is no metrics package to depend on.
 *
 * The package raises no `HandledError`. Its callers are workers, not customer
 * requests, and a handled error promises the caller an action it can take —
 * see `errors.ts` for where that line falls.
 */

export {
  ConfigurationError,
  EventSourcingError,
  MalformedGroupKeyError,
  UndecodableStateError,
} from "./errors";
export type { ErrorContext } from "./errors";

export {
  escapeSegment,
  parseGroupKey,
  renderGroupKey,
  scopeCanBatch,
  unescapeSegment,
} from "./dispatch/groupKey";
export type {
  GroupKey,
  Lane,
  Scope,
  StatefulGroupKey,
  StatefulLaneKind,
  StatefulScope,
} from "./dispatch/groupKey.types";

export { noopMetrics } from "./ports/metrics";
export type {
  CounterHandle,
  HistogramHandle,
  HistogramSpec,
  Metrics,
  MetricLabels,
  MetricSpec,
} from "./ports/metrics";

export { EVENT_SOURCING_TRACER, tracer, withSpan } from "./ports/tracing";

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
 *
 * `package.json` names this file as the package's only entry point, so every
 * part of that substrate has to appear below: a symbol that exists in `src/` but
 * is not re-exported here is unreachable from outside the package, and the
 * application cannot mount a projection it cannot import.
 */

export {
  defineAggregate,
} from "./aggregate/defineAggregate";
export type {
  AggregateCommanded,
  AggregateEvented,
  AggregateNamed,
  AggregateStated,
  BuildOptions,
} from "./aggregate/defineAggregate";
export type {
  Aggregate,
  AggregateEvent,
  CommandDef,
  CommandMap,
  EventCreators,
  EventData,
  EventDef,
  EventMap,
  EventTypeString,
  EventUnion,
} from "./aggregate/aggregate.types";

export { deriveStateVersion, resolveStateVersion } from "./aggregate/stateVersion";
export { checkTypeStringRatchet, mergeSnapshot } from "./aggregate/ratchet";
export type { RatchetViolation, TypeStringSnapshot } from "./aggregate/ratchet";

export { createFoldExecutor } from "./projections/foldExecutor";
export type {
  FoldDelivery,
  FoldExecutorDeps,
  FoldOutcome,
} from "./projections/foldExecutor";
export { createMapExecutor } from "./projections/mapExecutor";
export type { MapDelivery, MapExecutorDeps } from "./projections/mapExecutor";
export { checkOrderInvariance } from "./projections/orderInvariance";
export type { OrderInvarianceReport } from "./projections/orderInvariance";

export { compileSchema, createCompiledSchemaCache, timeValidation } from "./schema/compiled";
export type {
  CompiledSchema,
  CompiledSchemaCache,
  ValidationTiming,
} from "./schema/compiled";

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

export type {
  AppendStore,
  BatchContext,
  MergeStore,
  ReplaceStore,
  StateRead,
  Store,
  StoreContext,
  StoreDeps,
  StoredState,
  TenantId,
} from "./projections/store.types";

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
export type {
  AggregateCommanded,
  AggregateEvented,
  AggregateNamed,
  AggregateStated,
  BuildOptions,
} from "./aggregate/defineAggregate";
export { defineAggregate } from "./aggregate/defineAggregate";
export type { RatchetViolation, TypeStringSnapshot } from "./aggregate/ratchet";
export { checkTypeStringRatchet, mergeSnapshot } from "./aggregate/ratchet";
export {
  deriveStateVersion,
  resolveStateVersion,
} from "./aggregate/stateVersion";
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
export type { ErrorContext } from "./errors";
export {
  ConfigurationError,
  EventSourcingError,
  MalformedGroupKeyError,
  UndecodableStateError,
} from "./errors";
export type {
  CollapseKind,
  Idempotency,
  Mount,
  MountShape,
  MountViolation,
  ProjectionKind,
  ScopeKind,
  StoreKind,
} from "./mount/mount.types";
export {
  COLLAPSE_KINDS,
  IDEMPOTENCY_KINDS,
  PROJECTION_KINDS,
  SCOPE_KINDS,
  STORE_KINDS,
} from "./mount/mount.types";
export type { LegalMountShape } from "./mount/validateMount";
export { LEGAL_MOUNT_SHAPES, validateMount } from "./mount/validateMount";
export type {
  CounterHandle,
  HistogramHandle,
  HistogramSpec,
  MetricLabels,
  MetricSpec,
  Metrics,
} from "./ports/metrics";
export { noopMetrics } from "./ports/metrics";
export { EVENT_SOURCING_TRACER, tracer, withSpan } from "./ports/tracing";
export type {
  ProcessEvolved,
  ProcessEvolvedWaked,
  ProcessIntented,
  ProcessNamed,
  ProcessOnEvents,
  ProcessScheduled,
  ProcessScheduledWaked,
  ProcessStated,
} from "./process/defineProcess";
export { defineProcess } from "./process/defineProcess";
export type {
  EventUnionOf,
  EvolveDrivenProcess,
  EvolveFn,
  EvolveStep,
  EvolveWakeFn,
  IntentCreators,
  IntentData,
  IntentDef,
  IntentMap,
  IntentTypeString,
  IntentUnion,
  Process,
  ProcessBase,
  ProcessContext,
  ProcessIntent,
  ScheduledProcess,
  ScheduleStep,
  ScheduleWakeFn,
} from "./process/process.types";
export { processGroupKey } from "./process/processGroupKey";
export type {
  FoldDelivery,
  FoldExecutorDeps,
  FoldOutcome,
} from "./projections/foldExecutor";
export { createFoldExecutor } from "./projections/foldExecutor";
export type { MapDelivery, MapExecutorDeps } from "./projections/mapExecutor";
export { createMapExecutor } from "./projections/mapExecutor";
export type { OrderInvarianceReport } from "./projections/orderInvariance";
export { checkOrderInvariance } from "./projections/orderInvariance";
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
export type {
  CompiledSchema,
  CompiledSchemaCache,
  ValidationTiming,
} from "./schema/compiled";
export {
  compileSchema,
  createCompiledSchemaCache,
  timeValidation,
} from "./schema/compiled";

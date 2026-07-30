/**
 * `@langwatch/event-sourcing` — `definePipeline`, the ports a pipeline's
 * handlers reach through, and the checks that run over what a pipeline
 * declares. Pipelines and the composition root stay in the application
 * (ADR-102).
 *
 * This file is the package's only entry point, so a symbol not re-exported
 * here is unreachable from outside it.
 */

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
export { processGroupKey } from "./dispatch/processGroupKey";
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
  CommandBuilt,
  FoldWithStore,
  MapWithStore,
  PipelineChain,
  PipelineChainWithId,
  PipelineNamed,
  PipelineNamedPrefixed,
  PipelinePorts,
  ProcessManagerOn,
  SubscriberOn,
} from "./pipeline/definePipeline";
export { definePipeline } from "./pipeline/definePipeline";
export type {
  BuiltCommand,
  BuiltEvolveStep,
  BuiltFold,
  BuiltMap,
  BuiltPipeline,
  BuiltProcessManager,
  BuiltProcessManagerIntent,
  BuiltSubscriber,
  EmittedEvent,
  EmittedIntent,
  EventSchemaMap,
  EventTypeStrings,
  EvolveStep,
  FoldHandlerMap,
  HandlerContext,
  IdMap,
  IntentDef,
  IntentMap,
  IntentTypeStrings,
  MappedRow,
  MapHandlerMap,
  ProcessContext,
  ProcessManagerHandlerMap,
  SubscriberHandlerMap,
  WireEvent,
} from "./pipeline/pipeline.types";
export type { RatchetViolation, TypeStringSnapshot } from "./pipeline/ratchet";
export { checkTypeStringRatchet, mergeSnapshot } from "./pipeline/ratchet";
export type { EventTypeString, IntentTypeString } from "./pipeline/typeStrings";
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

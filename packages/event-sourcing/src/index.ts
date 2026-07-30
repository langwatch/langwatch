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
  MapHandlerMap,
  MappedRow,
  ProcessContext,
  ProcessManagerHandlerMap,
  SubscriberHandlerMap,
  WireEvent,
} from "./pipeline/pipeline.types";
export type {
  RatchetViolation,
  StateVersionDrift,
  StateVersionSnapshot,
  TypeStringSnapshot,
} from "./pipeline/ratchet";
export {
  checkStateVersionDrift,
  checkTypeStringRatchet,
  mergeSnapshot,
  snapshotFromRegistry,
  stateVersionsFromRegistry,
} from "./pipeline/ratchet";
export type { EventTypeString, IntentTypeString } from "./pipeline/typeStrings";
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
export { systemClock } from "./runtime/clock";
export type {
  ConsumerDeps,
  LaneExecution,
  LaneExecutors,
} from "./runtime/consumer";
export { createLaneConsumer } from "./runtime/consumer";
export type {
  BlobSpool,
  ClaimedBatch,
  ClaimRequest,
  Clock,
  CommandClient,
  CommittedEvent,
  ConsumerBudget,
  DispatchResult,
  DueProcessInstance,
  EnginePorts,
  EventLog,
  EventLogScan,
  EventProducer,
  EventSourcingService,
  Job,
  JobHeader,
  LaneConsumer,
  LaneKind,
  LaneQueue,
  Lease,
  Outbox,
  OutboxRow,
  ProcessInstanceKey,
  ProcessStore,
  RegisteredPipeline,
  Registry,
  ReplayReport,
  ReplayRequest,
  StagedJob,
  StoredProcessState,
} from "./runtime/contracts";
export {
  DispatchError,
  extractHttpStatus,
  isDispatchError,
  isRetryableHttpStatus,
  parseRetryAfterMs,
  toDispatchError,
} from "./runtime/dispatchError";
export type { MemoryOutbox, MemoryQueue } from "./runtime/memory";
export {
  memoryClock,
  memoryEventLog,
  memoryOutbox,
  memoryProcessStore,
  memoryQueue,
  memorySpool,
} from "./runtime/memory";
export type {
  ProcessDeliveryArgs,
  ProcessRuntime,
  ProcessRuntimeDeps,
  ProcessWakeArgs,
} from "./runtime/processRuntime";
export { createProcessRuntime } from "./runtime/processRuntime";
export type { EventProducerDeps } from "./runtime/producer";
export { createEventProducer } from "./runtime/producer";
export type { PipelineRegistry } from "./runtime/registry";
export { createRegistry } from "./runtime/registry";
export type { ReplayDeps } from "./runtime/replay";
export { createReplay } from "./runtime/replay";
export type { EventSourcingServiceDeps } from "./runtime/service";
export { createEventSourcingService } from "./runtime/service";
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

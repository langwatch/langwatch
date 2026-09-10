/**
 * Event Sourcing Module
 *
 * This module provides event sourcing infrastructure for the LangWatch application.
 * Create an EventSourcing instance during application startup with explicit dependencies.
 *
 * @example
 * ```typescript
 * import { EventSourcing } from '~/server/event-sourcing';
 *
 * const es = new EventSourcing({
 *   clickhouse: clickhouseClient,
 *   redis: redisConnection,
 * });
 *
 * // In tests
 * const es = EventSourcing.createForTesting({ eventStore: memoryStore });
 * ```
 */

// Commands
export type { Command, CommandHandler, CommandHandlerResult } from "./commands/command.ts";
export type { CommandEnvelope } from "./commands/commandEnvelope.ts";
export { stripEnvelope, withCommandEnvelope } from "./commands/commandEnvelope.ts";
export type { CommandHandlerClass } from "./commands/commandHandlerClass.ts";
export type { CommandSchema } from "./commands/commandSchema.ts";
export { defineCommandSchema } from "./commands/commandSchema.ts";
export type { DefinedCommandClass } from "./commands/defineCommand.ts";
export { defineCommand } from "./commands/defineCommand.ts";
export { eventIdempotencyKey } from "./commands/idempotency-key.ts";
// Domain types
export { AggregateTypeSchema, type AggregateType } from "./domain/aggregateType.ts";
export {
  createEventCatalogue,
  defineAggregate,
  defineEvent,
  defineEvents,
  EventCatalogue,
} from "./domain/definitions.ts";
export type { AggregateDefinition, EventDefinition } from "./domain/definitions.ts";
export type { EventType } from "./domain/eventType.ts";
export type { TenantId } from "./domain/tenantId.ts";
export { createTenantId, TenantIdSchema } from "./domain/tenantId.ts";
export type { Event, Projection } from "./domain/types.ts";
export { EventMetadataBaseSchema, EventSchema, ProjectionSchema } from "./domain/types.ts";
export type { ExecutionTarget, RetentionPolicy, RetentionPolicyResolver } from "./runtime.types.ts";
export type {
  EsKillSwitchKey,
  KillSwitchComponent,
  KillSwitchComponentSource,
  KillSwitchComponentType,
  KillSwitchDescriptor,
  KillSwitchOptions,
  KillSwitchQuery,
} from "./kill-switch/index.ts";
export {
  generateKillSwitchKey,
  isComponentKilled,
  killSwitchDescriptorsFor,
  KillSwitch,
} from "./kill-switch/index.ts";
export type { EventSourcingOptions } from "./eventSourcing.ts";
// Runtime
export { EventSourcing } from "./eventSourcing.ts";
// Pipeline (static definitions)
export { definePipeline, type PipelineBuilder } from "./pipeline/staticBuilder.ts";
// The seam into a module: one declaration `.withEventing(...)` takes.
export {
  defineEventingModule,
  type EventingCommandSender,
  type EventingCommands,
  type EventingConnection,
  type EventingModule,
  type EventingSetup,
} from "./pipeline/eventingModule.ts";
export type { ProcessManagerApplier } from "./pipeline/processBuilder.ts";
export type { SubscriberSpec, TriggerContext } from "./pipeline/processManagerDefinition.ts";
export type {
  CommandHandlerOptions,
  NoCommands,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "./pipeline/staticBuilder.types.ts";
// Pipeline (runtime)
export type {
  EventSourcingPipelineDefinition,
  PipelineMetadata,
  PipelineWithCommandHandlers,
  RegisteredPipeline,
} from "./pipeline/types.ts";
export type { MapEventHandlers } from "./projections/abstractMapProjection.ts";
export { AbstractMapProjection } from "./projections/abstractMapProjection.ts";
// Projections
export type {
  FoldProjectionDefinition,
  FoldProjectionOptions,
  FoldProjectionStore,
} from "./projections/foldProjection.types.ts";
export type {
  AppendStore,
  BulkAppendContext,
  MapProjectionDefinition,
  MapProjectionOptions,
} from "./projections/mapProjection.types.ts";
export type { ProjectionStoreContext } from "./projections/projectionStoreContext.ts";
export { RepositoryFoldStore } from "./projections/repositoryFoldStore.ts";
export type {
  ProjectionCursor,
  StateProjectionDefinition,
  StateProjectionOptions,
  StateProjectionStore,
  StoredProjection,
} from "./projections/stateProjection.types.ts";
// Queues
export type { EventSourcedQueueProcessor } from "./queues/index.ts";
export { EventSourcingPipeline } from "./runtimePipeline.ts";
// Services
export { EventSourcingService } from "./services/eventSourcingService.ts";
export type { JobRegistryEntry } from "./services/queues/queueManager.ts";
// Stores
export type {
  EventStore,
  EventStoreEventReadInput,
  EventStoreReadContext,
} from "./stores/eventStore.types.ts";
export type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "./stores/projectionStore.types.ts";
// Event-only subscribers
export type {
  EventSubscriberContext,
  EventSubscriberDefinition,
  EventSubscriberOptions,
} from "./subscribers/eventSubscriber.types.ts";
export type { SubscriberDispatchDefinition } from "./subscribers/subscriber.types.ts";
export { throttledPerWindow, throttledWindow } from "./subscribers/throttleWindow.ts";

export type {
  CutoffInfo,
  DiscoveredAggregate,
  OccurredAtBounds,
  ReplayEvent,
  ReplayEventSource,
} from "./replay/replayEventSource.ts";
export { ReplayService } from "./replay/replayService.ts";

// Utilities
export { EventUtils } from "./utils/event.utils.ts";

// Framework authoring and runtime surfaces used by application composition.
export * from "./deferred.ts";
export * from "./disabledPipeline.ts";
export * from "./mapCommands.ts";
export {
  NOOP_EVENT_SOURCING_METRICS,
  PROMETHEUS_EVENT_SOURCING_METRICS,
  type EventSourcingStoreMetrics,
} from "./metrics.ts";
export * from "./parseErrorText.ts";
export * from "./pipeline/processBuilder.ts";
export * from "./pipeline/processManagerDefinition.ts";
export * from "./process-manager/index.ts";
export * from "./process-manager/failureDiagnostic.ts";
export * from "./process-manager/metrics.ts";
export * from "./process-manager/processRuntime.ts";
export * from "./projections/abstractFoldProjection.ts";
export * from "./projections/foldProjectionExecutor.ts";
export * from "./projections/foldCache/foldCacheEntry.ts";
export * from "./projections/mapProjectionExecutor.ts";
export * from "./projections/projectionRouter.ts";
export * from "./projections/projectionStoreContext.ts";
export * from "./projections/redisCachedFoldStore.ts";
export * from "./projections/stateProjectionExecutor.ts";
export * from "./queues/dispatchError.ts";
export * from "./queues/groupQueueFactory.ts";
export * from "./queues/queue.types.ts";
export * from "./projections/replayMarkerCheck.ts";
export * from "./replay/pMapLimited.ts";
export * from "./replay/replayConstants.ts";
export * from "./replay/replayEngine.ts";
export * from "./replay/replayLog.ts";
export * from "./replay/replayStatePath.ts";
export * from "./replay/replayMarkers.ts";
export * from "./replay/types.ts";
export * from "./services/errorHandling.ts";
export * from "./stores/eventStoreUtils.ts";
export * from "./stores/abstractEventStore.ts";
export * from "./stores/eventStoreProducerOnly.ts";
export * from "./stores/baseMemoryProjectionStore.ts";
export * from "./stores/rehydrationWindow.ts";
export * from "./stores/repositories/eventRepository.types.ts";
export * from "./utils/compareOrdinal.ts";

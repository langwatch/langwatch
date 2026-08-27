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
export type { Command, CommandHandler, CommandHandlerResult } from "./commands/command";
export type { CommandEnvelope } from "./commands/commandEnvelope";
export { stripEnvelope, withCommandEnvelope } from "./commands/commandEnvelope";
export type { CommandHandlerClass } from "./commands/commandHandlerClass";
export type { CommandSchema } from "./commands/commandSchema";
export { defineCommandSchema } from "./commands/commandSchema";
export type { DefinedCommandClass } from "./commands/defineCommand";
export { defineCommand } from "./commands/defineCommand";
// Domain types
export { AggregateTypeSchema, type AggregateType } from "./domain/aggregateType";
export {
  createEventCatalogue,
  defineAggregate,
  defineEvent,
  defineEvents,
  EventCatalogue,
} from "./domain/definitions";
export type { AggregateDefinition, EventDefinition } from "./domain/definitions";
export type { EventType } from "./domain/eventType";
export type { TenantId } from "./domain/tenantId";
export { createTenantId, TenantIdSchema } from "./domain/tenantId";
export type { Event, Projection } from "./domain/types";
export { EventMetadataBaseSchema, EventSchema, ProjectionSchema } from "./domain/types";
export type {
  ExecutionTarget,
  RetentionPolicy,
  RetentionPolicyResolver,
} from "./runtime.types";
export type { EventSourcingOptions } from "./eventSourcing";
// Runtime
export { EventSourcing } from "./eventSourcing";
// Pipeline (static definitions)
export { definePipeline } from "./pipeline/staticBuilder";
export type { ProcessManagerApplier } from "./pipeline/processBuilder";
export type { SubscriberSpec, TriggerContext } from "./pipeline/processManagerDefinition";
export type {
  CommandHandlerOptions,
  NoCommands,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "./pipeline/staticBuilder.types";
// Pipeline (runtime)
export type {
  EventSourcingPipelineDefinition,
  PipelineMetadata,
  PipelineWithCommandHandlers,
  RegisteredPipeline,
} from "./pipeline/types";
export type { MapEventHandlers } from "./projections/abstractMapProjection";
export { AbstractMapProjection } from "./projections/abstractMapProjection";
// Projections
export type {
  FoldProjectionDefinition,
  FoldProjectionOptions,
  FoldProjectionStore,
} from "./projections/foldProjection.types";
export type {
  AppendStore,
  BulkAppendContext,
  MapProjectionDefinition,
  MapProjectionOptions,
} from "./projections/mapProjection.types";
export type { ProjectionStoreContext } from "./projections/projectionStoreContext";
export { RepositoryFoldStore } from "./projections/repositoryFoldStore";
export type {
  ProjectionCursor,
  StateProjectionDefinition,
  StateProjectionOptions,
  StateProjectionStore,
  StoredProjection,
} from "./projections/stateProjection.types";
// Queues
export type { EventSourcedQueueProcessor } from "./queues";
export { EventSourcingPipeline } from "./runtimePipeline";
// Services
export { EventSourcingService } from "./services/eventSourcingService";
export type { JobRegistryEntry } from "./services/queues/queueManager";
// Stores
export type {
  EventStore,
  EventStoreEventReadInput,
  EventStoreReadContext,
} from "./stores/eventStore.types";
export type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "./stores/projectionStore.types";
// Event-only subscribers
export type {
  EventSubscriberContext,
  EventSubscriberDefinition,
  EventSubscriberOptions,
} from "./subscribers/eventSubscriber.types";
export type { SubscriberDispatchDefinition } from "./subscribers/subscriber.types";
export { throttledPerWindow, throttledWindow } from "./subscribers/throttleWindow";

export type {
  CutoffInfo,
  DiscoveredAggregate,
  OccurredAtBounds,
  ReplayEvent,
  ReplayEventSource,
} from "./replay/replayEventSource";
export { ReplayService } from "./replay/replayService";

// Utilities
export { EventUtils } from "./utils/event.utils";

// Framework authoring and runtime surfaces used by application composition.
export * from "./deferred";
export * from "./disabledPipeline";
export * from "./mapCommands";
export * from "./parseErrorText";
export * from "./pipeline/processBuilder";
export * from "./pipeline/processManagerDefinition";
export * from "./process-manager";
export * from "./process-manager/failureDiagnostic";
export * from "./process-manager/metrics";
export * from "./process-manager/processRuntime";
export * from "./projections/abstractFoldProjection";
export * from "./projections/foldProjectionExecutor";
export * from "./projections/foldCache/foldCacheEntry";
export * from "./projections/mapProjectionExecutor";
export * from "./projections/projectionRouter";
export * from "./projections/projectionStoreContext";
export * from "./projections/redisCachedFoldStore";
export * from "./projections/stateProjectionExecutor";
export * from "./queues/dispatchError";
export * from "./queues/groupQueueFactory";
export * from "./queues/queue.types";
export * from "./projections/replayMarkerCheck";
export * from "./replay/pMapLimited";
export * from "./replay/replayConstants";
export * from "./replay/replayEngine";
export * from "./replay/replayLog";
export * from "./replay/replayStatePath";
export * from "./replay/replayMarkers";
export * from "./replay/types";
export * from "./services/errorHandling";
export * from "./stores/eventStoreUtils";
export * from "./stores/abstractEventStore";
export * from "./stores/baseMemoryProjectionStore";
export * from "./stores/rehydrationWindow";
export * from "./stores/repositories/eventRepository.types";
export * from "./utils/compareOrdinal";

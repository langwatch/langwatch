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
export type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "./commands/command";
export type { CommandEnvelope } from "./commands/commandEnvelope";
export { stripEnvelope, withCommandEnvelope } from "./commands/commandEnvelope";
export type { CommandHandlerClass } from "./commands/commandHandlerClass";
export type { CommandSchema } from "./commands/commandSchema";
export { defineCommandSchema } from "./commands/commandSchema";
export type { DefinedCommandClass } from "./commands/defineCommand";
export { defineCommand } from "./commands/defineCommand";
// Domain types
export type { AggregateType } from "./domain/aggregateType";
export type { EventType } from "./domain/eventType";
export type { TenantId } from "./domain/tenantId";
export { createTenantId } from "./domain/tenantId";
export type { Event, Projection } from "./domain/types";
export type { EventSourcingOptions } from "./eventSourcing";
// Runtime
export { EventSourcing } from "./eventSourcing";
// Pipeline (static definitions)
export { definePipeline } from "./pipeline/staticBuilder";
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
  FoldProjectionStore,
} from "./projections/foldProjection.types";
export type {
  AppendStore,
  MapProjectionDefinition,
} from "./projections/mapProjection.types";
export type { ProjectionStoreContext } from "./projections/projectionStoreContext";
export { RepositoryFoldStore } from "./projections/repositoryFoldStore";
export type { StateProjectionDefinition } from "./projections/stateProjection.types";
// Queues
export type { EventSourcedQueueProcessor } from "./queues";
export { EventSourcingPipeline } from "./runtimePipeline";
// Services
export { EventSourcingService } from "./services/eventSourcingService";
export type { JobRegistryEntry } from "./services/queues/queueManager";
// Stores
export type {
  EventStore,
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

// Utilities
export { EventUtils } from "./utils/event.utils";

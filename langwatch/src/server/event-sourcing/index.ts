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

// Domain types
export type { AggregateType } from "./domain/aggregateType";
export { createTenantId } from "./domain/tenantId";
export type { TenantId } from "./domain/tenantId";
export type { Event, Projection } from "./domain/types";
export type { EventType } from "./domain/eventType";

// Commands
export type { Command, CommandHandler, CommandHandlerResult } from "./commands/command";
export type { CommandHandlerClass } from "./commands/commandHandlerClass";
export { defineCommandSchema } from "./commands/commandSchema";
export type { CommandSchema } from "./commands/commandSchema";

// Pipeline (static definitions)
export { definePipeline } from "./pipeline/staticBuilder";
export type {
  CommandHandlerOptions, NoCommands,
  RegisteredCommand, StaticPipelineDefinition
} from "./pipeline/staticBuilder.types";

// Pipeline (runtime)
export type {
  EventSourcingPipelineDefinition,
  PipelineMetadata,
  PipelineWithCommandHandlers,
  RegisteredPipeline
} from "./pipeline/types";
export { EventSourcingPipeline } from "./runtimePipeline";

// Runtime
export { EventSourcing } from "./eventSourcing";
export type { EventSourcingOptions } from "./eventSourcing";

// Stores
export type { EventStore, EventStoreReadContext } from "./stores/eventStore.types";
export type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext
} from "./stores/projectionStore.types";

// Projections
export type { FoldProjectionDefinition, FoldProjectionStore } from "./projections/foldProjection.types";
export type { AppendStore, MapProjectionDefinition } from "./projections/mapProjection.types";
export type { ProjectionStoreContext } from "./projections/projectionStoreContext";

// Queues
export type { EventSourcedQueueProcessor } from "./queues";
export type { JobRegistryEntry } from "./services/queues/queueManager";

// Services
export { EventSourcingService } from "./services/eventSourcingService";

// Utilities
export { EventUtils } from "./utils/event.utils";

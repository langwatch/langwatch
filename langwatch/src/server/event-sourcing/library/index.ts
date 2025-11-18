/**
 * Generic Event Sourcing Library
 *
 * This library provides the core interfaces and patterns for event-sourced systems.
 * It can be reused across different domains (traces, users, etc.) by implementing
 * the specific event and projection types.
 */

// Core types & stream
export { EventStream } from "./core/eventStream";
export type {
  Event,
  EventMetadataBase,
  EventOrderingStrategy,
  Projection,
  ProjectionEnvelope,
  ProjectionMetadata,
} from "./core/types";
export type { AggregateType } from "./core/aggregateType";
export type { CommandType } from "./core/commandType";
export type { EventType } from "./core/eventType";
export type { TenantId } from "./core/tenantId";
export { createTenantId } from "./core/tenantId";
export type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "./core/command";
export { createCommand } from "./core/command";

// Processing interfaces
export type { EventHandler } from "./processing/eventHandler";

// Store interfaces
export type {
  EventStore,
  ReadOnlyEventStore,
  EventStoreReadContext,
  EventStoreListCursor,
  ListAggregateIdsResult,
} from "./stores/eventStore.types";
export type {
  BulkRebuildCheckpoint,
  CheckpointStore,
} from "./stores/bulkRebuildCheckpoint";
export type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "./stores/projectionStore.types";

// Services & pipeline
export { EventSourcingService } from "./services/eventSourcingService";
export type {
  EventSourcingHooks,
  EventSourcingOptions,
  RebuildProjectionOptions,
} from "./services/eventSourcingService.types";
export { runBulkRebuildWithCheckpoint } from "./services/bulkRebuild";
export type {
  EventSourcingPipelineDefinition,
  RegisteredPipeline,
} from "./pipeline.types";

// Utility functions
export {
  createEvent,
  createEventWithProcessingTraceContext,
  createEventStream,
  createProjection,
  eventBelongsToAggregate,
  sortEventsByTimestamp,
  filterEventsByType,
  getLatestProjection,
  isValidEvent,
  isValidProjection,
  buildProjectionMetadata,
  buildEventMetadataWithCurrentProcessingTraceparent,
  EventUtils,
} from "./utils/event.utils";

// Distributed locking
export type {
  DistributedLock,
  LockHandle,
  RedisClient,
} from "./utils/distributedLock";
export {
  InMemoryDistributedLock,
  RedisDistributedLock,
  DistributedLockUtils,
} from "./utils/distributedLock";

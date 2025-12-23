/**
 * Generic Event Sourcing Library
 *
 * This library provides the core interfaces and patterns for event-sourced systems.
 * It can be reused across different domains (traces, users, etc.) by implementing
 * the specific event and projection types.
 */

export type {
  EventSourcingPipelineDefinition,
  RegisteredPipeline,
} from "../runtime/pipeline";
export type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "./commands/command";
export {
  CommandSchema,
  createCommand,
  validateCommand,
} from "./commands/command";
export type {
  CommandHandlerClass,
  CommandHandlerClassStatic,
  ExtractCommandHandlerEvent,
  ExtractCommandHandlerPayload,
  ExtractCommandHandlerType,
} from "./commands/commandHandlerClass";
export type { CommandSchema as CommandSchemaType } from "./commands/commandSchema";
export { defineCommandSchema } from "./commands/commandSchema";
export type { AggregateType } from "./domain/aggregateType";
export { AggregateTypeSchema } from "./domain/aggregateType";
export type { CommandType } from "./domain/commandType";
export { CommandTypeSchema } from "./domain/commandType";
export type { EventType } from "./domain/eventType";
export { EventTypeSchema } from "./domain/eventType";
export type { EventHandler } from "./domain/handlers/eventHandler";
export type {
  EventHandlerClass,
  EventHandlerClassStatic,
  ExtractEventHandlerEvent,
} from "./domain/handlers/eventHandlerClass";
export type { ProjectionHandler } from "./domain/handlers/projectionHandler";
export type {
  ExtractProjectionHandlerEvent,
  ExtractProjectionHandlerProjection,
  ProjectionHandlerClass,
  ProjectionHandlerClassStatic,
} from "./domain/handlers/projectionHandlerClass";
export type {
  ExtractAggregateId,
  ExtractEventPayload,
  ExtractProjectionData,
  InferEventStoreEvent,
  InferProjectionHandlerEvent,
  InferProjectionHandlerProjection,
  InferProjectionStoreProjection,
} from "./domain/helpers";
export { isEvent, isProjection } from "./domain/helpers";
export type { TenantId } from "./domain/tenantId";
export { createTenantId, TenantIdSchema } from "./domain/tenantId";
export type {
  Event,
  EventMetadataBase,
  EventOrderingStrategy,
  ProcessorCheckpoint,
  Projection,
  ProjectionEnvelope,
  ProjectionMetadata,
  ProjectionType,
} from "./domain/types";
export {
  createProjectionEnvelopeSchema,
  EventMetadataBaseSchema,
  EventSchema,
  ProcessorCheckpointSchema,
  ProjectionEnvelopeSchema,
  ProjectionMetadataSchema,
  ProjectionSchema,
} from "./domain/types";
export type {
  ProjectionDefinition,
  ProjectionDefinitions,
} from "./projection.types";
export type { EventPublisher } from "./publishing/eventPublisher.types";
export type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
  EventSourcedQueueProcessorOptions,
} from "./queues";
export { EventSourcingService } from "./services/eventSourcingService";
export type {
  EventSourcingOptions,
  ReplayEventsOptions,
  UpdateProjectionOptions,
} from "./services/eventSourcingService.types";
export type { ProcessorCheckpointStore } from "./stores/eventHandlerCheckpointStore.types";
export type {
  EventStore,
  EventStoreReadContext,
  ReadOnlyEventStore,
} from "./stores/eventStore.types";
export { EventStoreReadContextSchema } from "./stores/eventStore.types";
export type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "./stores/projectionStore.types";
export { ProjectionStoreReadContextSchema } from "./stores/projectionStore.types";
export type { EventStreamMetadata } from "./streams/eventStream";
export { EventStream, EventStreamMetadataSchema } from "./streams/eventStream";
export type {
  DistributedLock,
  LockHandle,
  RedisClient,
} from "./utils/distributedLock";
export {
  DistributedLockUtils,
  InMemoryDistributedLock,
  LockHandleSchema,
  RedisDistributedLock,
} from "./utils/distributedLock";
export type { CreateEventOptions } from "./utils/event.utils";
export {
  buildEventMetadataWithCurrentProcessingTraceparent,
  buildProjectionMetadata,
  createEvent,
  createEventStream,
  createProjection,
  EventUtils,
  eventBelongsToAggregate,
  filterEventsByType,
  getLatestProjection,
  isValidEvent,
  isValidProjection,
  sortEventsByTimestamp,
} from "./utils/event.utils";

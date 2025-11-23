/**
 * Generic Event Sourcing Library
 *
 * This library provides the core interfaces and patterns for event-sourced systems.
 * It can be reused across different domains (traces, users, etc.) by implementing
 * the specific event and projection types.
 */

export type {
  Event,
  EventMetadataBase,
  EventOrderingStrategy,
  Projection,
  ProjectionEnvelope,
  ProjectionMetadata,
  ProcessorCheckpoint,
} from "./domain/types";
export {
  EventSchema,
  ProjectionSchema,
  EventMetadataBaseSchema,
  ProjectionMetadataSchema,
  ProjectionEnvelopeSchema,
  createProjectionEnvelopeSchema,
  ProcessorCheckpointSchema,
} from "./domain/types";
export type { ProjectionType } from "./domain/types";
export type { AggregateType } from "./domain/aggregateType";
export { AggregateTypeSchema } from "./domain/aggregateType";
export type { CommandType } from "./domain/commandType";
export { CommandTypeSchema } from "./domain/commandType";
export type { EventType } from "./domain/eventType";
export { EventTypeSchema } from "./domain/eventType";
export type { TenantId } from "./domain/tenantId";
export { TenantIdSchema, createTenantId } from "./domain/tenantId";

export { EventStream } from "./streams/eventStream";
export type { EventStreamMetadata } from "./streams/eventStream";
export { EventStreamMetadataSchema } from "./streams/eventStream";

export type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "./commands/command";
export { CommandSchema, createCommand, validateCommand } from "./commands/command";
export type {
  CommandSchema as CommandSchemaType,
} from "./commands/commandSchema";
export { defineCommandSchema } from "./commands/commandSchema";
export type {
  CommandHandlerClass,
  CommandHandlerClassStatic,
  ExtractCommandHandlerPayload,
  ExtractCommandHandlerType,
  ExtractCommandHandlerEvent,
} from "./commands/commandHandlerClass";

export type { EventHandler } from "./domain/handlers/eventHandler";
export type {
  EventHandlerClass,
  EventHandlerClassStatic,
  ExtractEventHandlerEvent,
} from "./domain/handlers/eventHandlerClass";

export type { ProjectionHandler } from "./domain/handlers/projectionHandler";
export type {
  ProjectionHandlerClass,
  ProjectionHandlerClassStatic,
  ExtractProjectionHandlerEvent,
  ExtractProjectionHandlerProjection,
} from "./domain/handlers/projectionHandlerClass";

export type {
  ExtractAggregateId,
  ExtractEventPayload,
  ExtractProjectionData,
  InferProjectionHandlerEvent,
  InferProjectionHandlerProjection,
  InferEventStoreEvent,
  InferProjectionStoreProjection,
} from "./domain/helpers";
export { isEvent, isProjection } from "./domain/helpers";

export type {
  EventStore,
  ReadOnlyEventStore,
  EventStoreReadContext,
} from "./stores/eventStore.types";
export { EventStoreReadContextSchema } from "./stores/eventStore.types";
export type {
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "./stores/projectionStore.types";
export { ProjectionStoreReadContextSchema } from "./stores/projectionStore.types";
export type {
  ProcessorCheckpointStore,
} from "./stores/eventHandlerCheckpointStore.types";

export type {
  EventSourcedQueueProcessor,
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessorOptions,
} from "./queues";

export { EventSourcingService } from "./services/eventSourcingService";
export type {
  EventSourcingOptions,
  UpdateProjectionOptions,
  ReplayEventsOptions,
} from "./services/eventSourcingService.types";
export type {
  ProjectionDefinition,
  ProjectionDefinitions,
} from "./projection.types";
export type { EventPublisher } from "./publishing/eventPublisher.types";
export type {
  EventSourcingPipelineDefinition,
  RegisteredPipeline,
} from "../runtime/pipeline";

export {
  createEvent,
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
export type { CreateEventOptions } from "./utils/event.utils";

export type {
  DistributedLock,
  LockHandle,
  RedisClient,
} from "./utils/distributedLock";
export {
  LockHandleSchema,
  InMemoryDistributedLock,
  RedisDistributedLock,
  DistributedLockUtils,
} from "./utils/distributedLock";

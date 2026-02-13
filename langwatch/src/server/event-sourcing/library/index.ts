/**
 * Generic Event Sourcing Library
 *
 * This library provides the core interfaces and patterns for event-sourced systems.
 * It can be reused across different domains (traces, users, etc.) by implementing
 * the specific event and projection types.
 */

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
  ParentLink,
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
export { definePipeline } from "./pipeline/staticBuilder";
export type {
  CommandHandlerOptions as StaticCommandHandlerOptions,
  NoCommands,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "./pipeline/types";
export type {
  ProjectionDefinition,
  ProjectionDefinitions,
} from "./projection.types";
export type { EventPublisher } from "./eventPublisher.types";
export type {
  DeduplicationConfig,
  DeduplicationStrategy,
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
  EventSourcedQueueProcessorOptions,
  QueueProcessorFactory,
} from "./queues";
export { EventSourcingService } from "./services/eventSourcingService";
export type {
  EventSourcingOptions,
  UpdateProjectionOptions,
} from "./services/eventSourcingService.types";
export type { CheckpointStore } from "./stores/checkpointStore.types";
/**
 * @deprecated Use CheckpointStore instead
 */
export type { CheckpointStore as ProcessorCheckpointStore } from "./stores/checkpointStore.types";
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
export type { CreateEventOptions } from "./utils/event.utils";
export { EventUtils } from "./utils/event.utils";

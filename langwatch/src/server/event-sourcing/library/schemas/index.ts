/**
 * Base schemas for the event-sourcing library.
 * These are generic schemas that can be used across different domains.
 * Re-exported from domain types for backwards compatibility.
 */
export {
  EventSchema,
  ProjectionSchema,
  EventMetadataBaseSchema,
  ProjectionMetadataSchema,
  ProjectionEnvelopeSchema,
  createProjectionEnvelopeSchema,
  EventHandlerCheckpointSchema,
} from "../domain/types";
export type { ProjectionType } from "../domain/types";
export { TenantIdSchema } from "../domain/tenantId";
export { EventTypeSchema } from "../domain/eventType";
export { CommandTypeSchema } from "../domain/commandType";
export { AggregateTypeSchema } from "../domain/aggregateType";
export { CommandSchema } from "../commands/command";
export { EventStreamMetadataSchema } from "../streams/eventStream";
export {
  EventStoreReadContextSchema,
} from "../stores/eventStore.types";
export {
  ProjectionStoreReadContextSchema,
} from "../stores/projectionStore.types";
export { LockHandleSchema } from "../utils/distributedLock";

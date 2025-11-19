/**
 * Core types for the event sourcing library.
 */

import { z } from "zod";
import { EventTypeSchema } from "./eventType";
import { TenantIdSchema } from "./tenantId";
import { AggregateTypeSchema } from "./aggregateType";

/**
 * Zod schema for event metadata base.
 * W3C traceparent header value capturing the originating OTel trace context
 * of the processing pipeline (ingestion, reprocessing jobs, etc.).
 * Example: "00-<trace-id>-<span-id>-01"
 */
export const EventMetadataBaseSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Base metadata type for events.
 * Includes optional processingTraceparent for tracking which pipeline created the event.
 */
export type EventMetadataBase = z.infer<typeof EventMetadataBaseSchema>;

/**
 * Zod schema for Event objects.
 * Enhanced with proper validation for timestamp and tenantId.
 */
export const EventSchema = z.object({
  /** Unique identifier for the event */
  id: z.string(),
  /** Unique identifier for the aggregate this event belongs to */
  aggregateId: z.string(),
  /** The tenant ID associated with the event */
  tenantId: TenantIdSchema,
  /** When this event occurred (Unix timestamp in milliseconds) */
  timestamp: z.number().int().nonnegative(),
  /** Event type for routing and processing */
  type: EventTypeSchema,
  /** Event-specific data */
  data: z.unknown(),
  /** Metadata about the event, optional */
  metadata: EventMetadataBaseSchema.optional(),
});

/**
 * Base event type inferred from EventSchema.
 */
type EventBase = z.infer<typeof EventSchema>;

/**
 * Generic event type with type-safe payload and metadata.
 *
 * Events represent facts that have occurred in the system. They are immutable and
 * stored in the event store. Events are processed by handlers to build projections.
 */
export type Event<
  Payload = unknown,
  Metadata = EventMetadataBase,
> = Omit<EventBase, "data" | "metadata"> & {
  /** Event-specific data */
  data: Payload;
  /** Metadata about the event, optional */
  metadata?: Metadata;
};

/**
 * Zod schema for Projection objects.
 * Represents the current state of an aggregate, built from events.
 * Projections are computed views that can be queried efficiently.
 */
export const ProjectionSchema = z.object({
  /** Unique identifier for this projection */
  id: z.string(),
  /** The aggregate this projection represents */
  aggregateId: z.string(),
  /** The tenant ID associated with the projection */
  tenantId: TenantIdSchema,
  /** Version/timestamp when this projection was last updated */
  version: z.number().int().nonnegative(),
  /** The projection data */
  data: z.unknown(),
});

/**
 * Base projection type inferred from ProjectionSchema.
 */
export type ProjectionType = z.infer<typeof ProjectionSchema>;

/**
 * Generic projection type with type-safe data.
 *
 * Projections represent the current state of an aggregate, computed from events.
 * They are queryable views optimized for read operations.
 */
export type Projection<Data = unknown> = Omit<ProjectionType, "data"> & {
  /** The projection data */
  data: Data;
};

/**
 * Zod schema for projection metadata.
 * Metadata describing the events that produced a projection.
 */
export const ProjectionMetadataSchema = z.object({
  /** Number of events processed */
  eventCount: z.number().int().nonnegative(),
  /** Timestamp of the earliest event in the stream */
  firstEventTimestamp: z.number().int().nonnegative().nullable(),
  /** Timestamp of the latest event in the stream */
  lastEventTimestamp: z.number().int().nonnegative().nullable(),
  /** When this projection computation occurred */
  computedAtUnixMs: z.number().int().nonnegative(),
});

export type ProjectionMetadata = z.infer<typeof ProjectionMetadataSchema>;

/**
 * Zod schema for projection envelope.
 * Wrapper returned by the projection pipeline to include metadata.
 * Uses the base ProjectionSchema. For custom projection schemas, use createProjectionEnvelopeSchema.
 */
export const ProjectionEnvelopeSchema = z.object({
  projection: ProjectionSchema,
  metadata: ProjectionMetadataSchema,
});

/**
 * Factory function to create a projection envelope schema for a custom projection schema.
 * Use this when you have a specific projection schema that extends the base ProjectionSchema.
 *
 * @param projectionSchema - The custom projection schema to use
 * @returns A Zod schema for the projection envelope
 */
export function createProjectionEnvelopeSchema<TProjection extends ProjectionType>(
  projectionSchema: z.ZodType<TProjection>,
) {
  return z.object({
    projection: projectionSchema,
    metadata: ProjectionMetadataSchema,
  });
}

/**
 * Projection envelope with type-safe projection.
 * Extends the base envelope type from the schema while allowing generic projection types.
 */
export type ProjectionEnvelope<
  TProjection extends Projection = Projection,
> = {
  projection: TProjection;
  metadata: ProjectionMetadata;
};

/**
 * Strategy for ordering events prior to processing.
 *
 * - "as-is": Preserves the order of events as provided (no sorting applied).
 *   Use when upstream (e.g., ClickHouse) has already provided correctly ordered events.
 * - "timestamp": Sorts events chronologically by their timestamp field (earliest first).
 *   Default strategy for most use cases.
 * - Custom function: Provide a comparator function for custom sorting logic.
 */
export type EventOrderingStrategy<TEvent> =
  | "as-is"
  | "timestamp"
  | ((a: TEvent, b: TEvent) => number);

/**
 * Zod schema for event handler checkpoint.
 * Checkpoint tracking the last processed event for an event handler.
 * Used for resuming processing after failures and for replay scenarios.
 */
export const EventHandlerCheckpointSchema = z.object({
  /**
   * The handler name this checkpoint belongs to.
   */
  handlerName: z.string(),
  /**
   * The tenant ID this checkpoint is scoped to.
   */
  tenantId: TenantIdSchema,
  /**
   * The aggregate type this checkpoint is for.
   */
  aggregateType: AggregateTypeSchema,
  /**
   * The last processed aggregate ID.
   */
  lastProcessedAggregateId: z.string(),
  /**
   * The timestamp of the last processed event (Unix milliseconds).
   */
  lastProcessedTimestamp: z.number().int().nonnegative(),
  /**
   * A unique identifier for the last processed event.
   * Format: `${aggregateId}:${timestamp}:${eventType}`
   */
  lastProcessedEventId: z.string(),
});

/**
 * Checkpoint tracking the last processed event for an event handler.
 *
 * Used for resuming processing after failures and for replay scenarios.
 * Checkpoints are stored per handler, tenant, and aggregate type.
 */
export type EventHandlerCheckpoint = z.infer<
  typeof EventHandlerCheckpointSchema
>;

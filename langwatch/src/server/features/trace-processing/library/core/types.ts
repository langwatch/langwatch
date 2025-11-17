/**
 * Core types for the event sourcing library.
 */

export interface EventMetadataBase {
  /**
   * W3C traceparent header value capturing the originating OTel trace context
   * of the processing pipeline (ingestion, reprocessing jobs, etc.).
   * Example: "00-<trace-id>-<span-id>-01"
   */
  processingTraceparent?: string;
  [key: string]: unknown;
}

export interface Event<
  AggregateId = string,
  Payload = unknown,
  Metadata = EventMetadataBase,
> {
  /** Unique identifier for the aggregate this event belongs to */
  aggregateId: AggregateId;
  /** When this event occurred (Unix timestamp in milliseconds) */
  timestamp: number;
  /** Event type for routing and processing */
  type: string;
  /** Event-specific data */
  data: Payload;
  /** Optional metadata about the event */
  metadata?: Metadata;
}

/**
 * Represents the current state of an aggregate, built from events.
 * Projections are computed views that can be queried efficiently.
 */
export interface Projection<AggregateId = string, Data = unknown> {
  /** Unique identifier for this projection */
  id: string;
  /** The aggregate this projection represents */
  aggregateId: AggregateId;
  /** Version/timestamp when this projection was last updated */
  version: number;
  /** The projection data */
  data: Data;
}

/**
 * Metadata describing the events that produced a projection.
 */
export interface ProjectionMetadata {
  /** Number of events processed */
  eventCount: number;
  /** Timestamp of the earliest event in the stream */
  firstEventTimestamp: number | null;
  /** Timestamp of the latest event in the stream */
  lastEventTimestamp: number | null;
  /** When this projection computation occurred */
  computedAtUnixMs: number;
}

/**
 * Wrapper returned by the projection pipeline to include metadata.
 */
export interface ProjectionEnvelope<
  AggregateId = string,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> {
  projection: ProjectionType;
  metadata: ProjectionMetadata;
}

/**
 * Strategy for ordering events prior to processing.
 * - "as-is": Preserves the order of events as provided (no sorting applied)
 * - "timestamp": Sorts events chronologically by their timestamp field (earliest first)
 * - Custom function: Provide a comparator function for custom sorting logic
 */
export type EventOrderingStrategy<EventType> =
  | "as-is"
  | "timestamp"
  | ((a: EventType, b: EventType) => number);

/**
 * Types for managing event handlers per pipeline.
 */

import type { Event } from "./domain/types";
import type { EventReactionHandler } from "./domain/handlers/eventReactionHandler";

/**
 * Options for configuring an event handler.
 */
export interface EventHandlerOptions<
  EventType extends Event = Event,
  RegisteredHandlerNames extends string = string,
> {
  /**
   * Optional: Event types this handler is interested in.
   * If not provided, handler will receive all events for the aggregate type.
   */
  eventTypes?: EventType["type"][];
  /**
   * Optional: Names of other handlers this handler depends on.
   * Handlers will be executed in dependency order (dependencies first).
   * Use semantic names (e.g., "span-storage") not implementation names (e.g., "clickhouse-writer").
   * Type-safe: Only accepts handler names that have been registered before this handler.
   */
  dependsOn?: RegisteredHandlerNames extends never
    ? never
    : RegisteredHandlerNames[];
  /**
   * Optional: Custom job ID factory for idempotency.
   * Default: `${event.tenantId}:${event.aggregateId}:${event.timestamp}:${event.type}`
   */
  makeJobId?: (event: EventType) => string;
  /**
   * Optional: Delay in milliseconds before processing the job.
   */
  delay?: number;
  /**
   * Optional: Concurrency limit for processing jobs.
   */
  concurrency?: number;
  /**
   * Optional: Function to extract span attributes from the event.
   */
  spanAttributes?: (
    event: EventType,
  ) => Record<string, string | number | boolean>;
}

/**
 * Definition of an event handler that reacts to events.
 * Each handler has a unique name and processes individual events.
 */
export interface EventHandlerDefinition<
  EventType extends Event = Event,
  RegisteredHandlerNames extends string = string,
> {
  /**
   * Unique name for this handler within the pipeline.
   * Used for checkpointing and identification.
   */
  name: string;
  /**
   * Handler that processes individual events.
   */
  handler: EventReactionHandler<EventType>;
  /**
   * Options for configuring the handler.
   */
  options: EventHandlerOptions<EventType, RegisteredHandlerNames>;
}

/**
 * Map of handler names to their definitions.
 */
export type EventHandlerDefinitions<EventType extends Event = Event> = Record<
  string,
  EventHandlerDefinition<EventType>
>;

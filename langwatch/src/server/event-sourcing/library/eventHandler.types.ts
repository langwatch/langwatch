/**
 * Types for managing event handlers per pipeline.
 */

import type { EventHandler } from "./domain/handlers/eventHandler";
import type { Event } from "./domain/types";
import type { KillSwitchOptions } from "./pipeline/types";
import type { DeduplicationConfig } from "./queues";

/**
 * Options for configuring an event handler.
 */
export interface EventHandlerOptions<
  EventType extends Event = Event,
  AvailableDependencies extends string = string,
> {
  /**
   * Optional: Event types this handler is interested in.
   * If not provided, handler will receive all events for the aggregate type.
   */
  eventTypes?: readonly EventType["type"][];
  /**
   * Optional: Delay in milliseconds before processing the job.
   */
  delay?: number;
  /**
   * Optional: Deduplication configuration.
   * When set, jobs with the same deduplication ID will be deduplicated within the TTL window.
   * Default deduplication ID: `${event.tenantId}:${event.aggregateType}:${event.aggregateId}`
   */
  deduplication?: DeduplicationConfig<EventType>;
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
  /**
   * Optional: List of handler and projection names this handler depends on.
   * Handlers will be executed after all dependencies complete.
   * Can depend on both event handlers and projections.
   */
  dependsOn?: AvailableDependencies[];

  /**
   * Optional: Whether to disable the handler.
   */
  disabled?: boolean;

  /**
   * Kill switch configuration for this event handler.
   * When the feature flag is true, the handler is disabled.
   */
  killSwitch?: KillSwitchOptions;
}

/**
 * Definition of an event handler that reacts to events.
 * Each handler has a unique name and processes individual events.
 */
export interface EventHandlerDefinition<
  EventType extends Event = Event,
  AvailableDependencies extends string = string,
> {
  /**
   * Unique name for this handler within the pipeline.
   * Used for checkpointing and identification.
   */
  name: string;
  /**
   * Handler that processes individual events.
   */
  handler: EventHandler<EventType>;
  /**
   * Options for configuring the handler.
   */
  options: EventHandlerOptions<EventType, AvailableDependencies>;
}

/**
 * Map of handler names to their definitions.
 */
export type EventHandlerDefinitions<EventType extends Event = Event> = Record<
  string,
  EventHandlerDefinition<EventType>
>;

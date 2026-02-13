/**
 * Types for managing event handlers per pipeline.
 */

import type { EventHandler } from "./domain/handlers/eventHandler";
import type { Event } from "./domain/types";
import type { KillSwitchOptions } from "./pipeline/types";
import type { DeduplicationStrategy } from "./queues";

/**
 * Options for configuring an event handler.
 */
export interface EventHandlerOptions<
  EventType extends Event = Event,
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
   * Optional: Deduplication strategy for this handler.
   * @see DeduplicationStrategy for available options
   */
  deduplication?: DeduplicationStrategy<EventType>;
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
  options: EventHandlerOptions<EventType>;
}

/**
 * Map of handler names to their definitions.
 */
export type EventHandlerDefinitions<EventType extends Event = Event> = Record<
  string,
  EventHandlerDefinition<EventType>
>;

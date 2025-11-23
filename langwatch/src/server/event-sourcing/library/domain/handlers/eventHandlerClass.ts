import type { Event } from "../types";
import type { EventHandler } from "./eventHandler";

/**
 * Static properties and methods that can be defined on an EventHandlerClass.
 * These are accessed via the constructor (class) rather than instances.
 */
export interface EventHandlerClassStatic<EventType extends Event> {
  /**
   * Optional: Returns the event types this handler is interested in.
   * Can be overridden in pipeline options.
   * If not provided, handler will receive all events for the aggregate type.
   *
   * @returns Array of event type strings, or undefined to handle all events
   */
  getEventTypes?(): readonly EventType["type"][] | undefined;
}

/**
 * Self-contained event handler class that bundles handler implementation and configuration.
 *
 * This design allows pipeline registration by simply passing the class, eliminating the need
 * to separately configure handler and event type filtering. The framework extracts all
 * necessary information from static properties and methods.
 *
 * @example
 * ```typescript
 * class SpanClickHouseWriterHandler implements EventHandler<SpanIngestionEvent> {
 *   static getEventTypes() {
 *     return ["lw.obs.span_ingestion.recorded"] as const;
 *   }
 *
 *   async handle(event: SpanIngestionEvent): Promise<void> {
 *     await this.clickHouse.insert(event.data.spanData);
 *   }
 * }
 * ```
 */
export type EventHandlerClass<EventType extends Event> =
  EventHandlerClassStatic<EventType> & (new () => EventHandler<EventType>);

/**
 * Type helper to extract the event type from an EventHandlerClass.
 */
export type ExtractEventHandlerEvent<T> =
  T extends EventHandlerClass<infer EventType> ? EventType : never;

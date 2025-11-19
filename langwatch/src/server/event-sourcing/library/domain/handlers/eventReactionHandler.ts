import type { Event } from "../types";

/**
 * Handler that reacts to individual events as they are stored.
 * Unlike EventHandler (for projections), this processes single events asynchronously.
 *
 * Event handlers are orchestrated by the framework - they don't manage their own lifecycle.
 * The framework dispatches events to handlers via queues and maintains checkpoints.
 *
 * @example
 * ```typescript
 * class SpanClickHouseWriterHandler implements EventReactionHandler<SpanIngestionEvent> {
 *   async handle(event: SpanIngestionEvent): Promise<void> {
 *     await this.clickHouse.insert(event.data.spanData);
 *   }
 *
 *   getEventTypes(): string[] {
 *     return ["lw.obs.span.ingestion.recorded"];
 *   }
 * }
 * ```
 */
export interface EventReactionHandler<EventType extends Event = Event> {
  /**
   * Handles a single event.
   * This method should be idempotent - the framework ensures idempotency via event ID
   * in job IDs, but handlers can also implement their own checks.
   *
   * @param event - The event to handle
   * @returns Promise that resolves when handling is complete
   */
  handle(event: EventType): Promise<void>;

  /**
   * Optional: Returns the event types this handler is interested in.
   * If not provided, the handler will receive all events for the aggregate type.
   *
   * @returns Array of event type strings, or undefined to handle all events
   */
  getEventTypes?(): string[] | undefined;
}

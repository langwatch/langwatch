import type { Event } from "./domain/types";
import type { EventStoreReadContext } from "./stores/eventStore.types";

/**
 * Interface for publishing events to external systems (message queues, event buses, etc.).
 *
 * Event publishers are called after events are successfully stored in the event store.
 * If publishing fails, the error is logged but does not fail the event storage operation.
 *
 * @example
 * ```typescript
 * class KafkaEventPublisher implements EventPublisher<MyEvent> {
 *   async publish(
 *     events: readonly MyEvent[],
 *     context: EventStoreReadContext<MyEvent>,
 *   ): Promise<void> {
 *     await this.kafkaProducer.send({
 *       topic: 'events',
 *       messages: events.map(event => ({ value: JSON.stringify(event) }))
 *     });
 *   }
 * }
 * ```
 */
export interface EventPublisher<EventType extends Event = Event> {
  /**
   * Publishes events to an external system.
   *
   * @param events - The events to publish (readonly array)
   * @param context - The context in which the events were stored (includes tenantId, aggregateType, etc.)
   * @returns Promise that resolves when publishing is complete
   * @throws Error if publishing fails (errors are logged but don't fail event storage)
   */
  publish(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void>;
}

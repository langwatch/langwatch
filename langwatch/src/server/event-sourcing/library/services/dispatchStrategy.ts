import type { Event } from "../domain/types";
import type { EventStoreReadContext } from "../stores/eventStore.types";

/**
 * Strategy interface for dispatching events to processors (handlers or projections).
 * Allows different dispatch modes: synchronous (inline) or asynchronous (queue-based).
 */
export interface DispatchStrategy<EventType extends Event = Event> {
  /**
   * Dispatches events to processors.
   *
   * @param events - Events to dispatch
   * @param context - Event store read context
   * @param dispatchCallback - Callback to process a single event
   */
  dispatch(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    dispatchCallback: (event: EventType, context: EventStoreReadContext<EventType>) => Promise<void>,
  ): Promise<void>;
}

/**
 * Synchronous dispatch strategy - processes events inline.
 * Used when no queue processor factory is provided (fallback mode).
 */
export class SynchronousDispatchStrategy<EventType extends Event = Event>
  implements DispatchStrategy<EventType>
{
  async dispatch(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    dispatchCallback: (
      event: EventType,
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
  ): Promise<void> {
    for (const event of events) {
      await dispatchCallback(event, context);
    }
  }
}

/**
 * Queue-based dispatch strategy - processes events asynchronously via queues.
 * Used when queue processor factory is provided.
 */
export class QueueDispatchStrategy<EventType extends Event = Event>
  implements DispatchStrategy<EventType>
{
  constructor(
    private readonly sendToQueue: (
      event: EventType,
    ) => Promise<void>,
  ) {}

  async dispatch(
    events: readonly EventType[],
    _context: EventStoreReadContext<EventType>,
    _dispatchCallback: (
      event: EventType,
      context: EventStoreReadContext<EventType>,
    ) => Promise<void>,
  ): Promise<void> {
    for (const event of events) {
      await this.sendToQueue(event);
    }
  }
}


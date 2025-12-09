import { createLogger } from "~/utils/logger";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event } from "../../domain/types";
import type {
  EventStore,
  EventStoreReadContext,
} from "../../stores/eventStore.types";

/**
 * Calculates sequence numbers for events within their aggregates.
 * Sequence numbers are 1-indexed and represent the position of the event
 * in chronological order within the aggregate.
 */
export class SequenceNumberCalculator<EventType extends Event = Event> {
  private readonly logger = createLogger(
    "langwatch:event-sourcing:sequence-number-calculator",
  );

  constructor(
    private readonly eventStore: EventStore<EventType>,
    private readonly aggregateType: AggregateType,
  ) {}

  /**
   * Computes the sequence number for an event within its aggregate.
   * Sequence numbers are 1-indexed and represent the position of the event
   * in chronological order within the aggregate.
   *
   * @param event - The event to compute the sequence number for
   * @param context - Security context with required tenantId
   * @returns The sequence number (1-indexed)
   */
  async computeEventSequenceNumber(
    event: EventType,
    context: EventStoreReadContext<EventType>,
  ): Promise<number> {
    const count = await this.eventStore.countEventsBefore(
      String(event.aggregateId),
      context,
      this.aggregateType,
      event.timestamp,
      event.id,
    );

    const sequenceNumber = count + 1;

    this.logger.debug(
      {
        eventId: event.id,
        timestamp: event.timestamp,
        aggregateId: event.aggregateId,
        aggregateType: this.aggregateType,
        tenantId: context.tenantId,
        count,
        sequenceNumber,
      },
      "Computed sequence number for event",
    );

    // Return count + 1 for 1-indexed sequence number
    return sequenceNumber;
  }
}

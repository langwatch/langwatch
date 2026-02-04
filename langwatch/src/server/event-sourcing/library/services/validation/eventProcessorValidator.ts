import { createLogger } from "~/utils/logger/server";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event } from "../../domain/types";
import type { ProcessorCheckpointStore } from "../../stores/eventHandlerCheckpointStore.types";
import type {
  EventStore,
  EventStoreReadContext,
} from "../../stores/eventStore.types";
import { FailureDetector } from "./failureDetector";
import { IdempotencyChecker } from "./idempotencyChecker";
import { OrderingValidator } from "./orderingValidator";
import { SequenceNumberCalculator } from "./sequenceNumberCalculator";

/**
 * Orchestrates event processing validation by coordinating sequence number calculation,
 * idempotency checking, failure detection, and ordering validation.
 * Shared validation logic used by both handlers and projections.
 */
export class EventProcessorValidator<EventType extends Event = Event> {
  private readonly sequenceNumberCalculator: SequenceNumberCalculator<EventType>;
  private readonly idempotencyChecker: IdempotencyChecker<EventType>;
  private readonly orderingValidator: OrderingValidator<EventType>;
  private readonly failureDetector: FailureDetector<EventType>;
  private readonly logger = createLogger(
    "langwatch:event-sourcing:event-processor-validator",
  );

  constructor({
    eventStore,
    aggregateType,
    processorCheckpointStore,
    pipelineName,
  }: {
    eventStore: EventStore<EventType>;
    aggregateType: AggregateType;
    processorCheckpointStore?: ProcessorCheckpointStore;
    pipelineName: string;
  }) {
    this.sequenceNumberCalculator = new SequenceNumberCalculator(
      eventStore,
      aggregateType,
    );
    this.idempotencyChecker = new IdempotencyChecker(
      processorCheckpointStore,
      pipelineName,
    );
    this.orderingValidator = new OrderingValidator(
      processorCheckpointStore,
      pipelineName,
    );
    this.failureDetector = new FailureDetector(
      processorCheckpointStore,
      pipelineName,
    );
  }

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
    return await this.sequenceNumberCalculator.computeEventSequenceNumber(
      event,
      context,
    );
  }

  /**
   * Computes the sequence number for an event from a pre-loaded events array.
   * Sequence numbers are 1-indexed and represent the position of the event
   * in chronological order within the aggregate.
   *
   * @param event - The event to compute the sequence number for
   * @param events - Pre-loaded events array for the aggregate (must be sorted chronologically)
   * @returns The sequence number (1-indexed)
   * @throws {Error} If the event is not found in the events array
   */
  computeSequenceNumberFromEvents(
    event: EventType,
    events: readonly EventType[],
  ): number {
    return this.sequenceNumberCalculator.computeSequenceNumberFromEvents(
      event,
      events,
    );
  }

  /**
   * Validates event processing prerequisites and returns sequence number.
   *
   * Performs shared validation logic for both handlers and projections:
   * - Sequence number computation
   * - Idempotency check (already processed) and atomic claim
   * - Failed events check (skips gracefully)
   * - Sequential ordering validation (throws on violations)
   *
   * @param processorName - Name of the processor (handler or projection)
   * @param processorType - Type of processor ("handler" or "projection")
   * @param event - Event to validate
   * @param context - Event store read context
   * @param options - Optional validation options
   * @param options.events - Pre-loaded events array. If provided, uses this to compute sequence number instead of querying the event store.
   * @returns Sequence number if validation passes, null if processing should be skipped (already processed or has failures)
   * @throws {Error} If sequential ordering is violated or sequence number computation fails
   */
  async validateEventProcessing(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
    context: EventStoreReadContext<EventType>,
    options?: { events?: readonly EventType[] },
  ): Promise<number | null> {
    // Compute sequence number for this event
    let sequenceNumber: number;
    try {
      if (options?.events) {
        // Use pre-loaded events array to compute sequence number
        sequenceNumber = this.computeSequenceNumberFromEvents(
          event,
          options.events,
        );
      } else {
        // Fall back to querying the event store
        sequenceNumber = await this.computeEventSequenceNumber(event, context);
      }
    } catch (error) {
      this.logger.error(
        {
          processorName,
          processorType,
          eventId: event.id,
          aggregateId: String(event.aggregateId),
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to compute sequence number for event",
      );
      throw error;
    }

    // Check if any previous events failed (stop processing if so)
    // This check must happen BEFORE idempotency check to prevent overwriting failed checkpoints
    // and BEFORE ordering checks so it catches failures even when sequenceNumber is 1
    const hasFailures = await this.failureDetector.hasFailedEvents(
      processorName,
      processorType,
      event,
    );

    // Check if event already processed (idempotency) and atomically claim it
    // This happens even when there are failures to save a pending checkpoint for optimistic locking
    // but we still skip processing if there are failures
    const alreadyProcessed = await this.idempotencyChecker.checkAndClaim(
      processorName,
      processorType,
      event,
      sequenceNumber,
    );
    if (alreadyProcessed) {
      return null;
    }

    if (hasFailures) {
      const errorMessage =
        "Previous events have failed processing for this aggregate. Processing stopped to prevent cascading failures.";
      this.logger.warn(
        {
          processorName,
          processorType,
          eventId: event.id,
          aggregateId: String(event.aggregateId),
          tenantId: event.tenantId,
        },
        errorMessage,
      );
      // Skip processing gracefully (don't throw)
      // This allows storeEvents to succeed even when processing is skipped
      // The pending checkpoint was already saved by idempotency checker above
      return null;
    }

    // Enforce ordering: check if the immediate predecessor has been processed
    await this.orderingValidator.validateOrdering(
      processorName,
      processorType,
      event,
      sequenceNumber,
    );

    return sequenceNumber;
  }
}

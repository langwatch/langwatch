import type {
  AggregateType,
  EventStore as BaseEventStore,
  Event,
  EventStoreReadContext,
} from "../";
import { EventUtils } from "../";
import { ValidationError } from "../services/errorHandling";
import {
  deduplicateEvents,
  eventToRecord,
  recordToEvent,
  validateEventAggregateType,
  validateEventTenant,
} from "./eventStoreUtils";
import type { EventRepository } from "./repositories/eventRepository.types";

/**
 * Abstract base class for EventStore implementations using the Template Method pattern.
 *
 * Provides the shared skeleton for reading and writing events:
 * - Read methods: validate tenant -> instrument -> fetch records -> map to events -> post-process -> deduplicate
 * - Write method: instrument -> validate tenant -> validate each event -> map to records -> insert -> on success
 *
 * Subclasses customize behavior through four hook methods:
 * - `postProcessEvents`: transform events after deduplication (e.g., sort, clone)
 * - `instrument`: wrap operations in tracing spans
 * - `logError`: structured error logging
 * - `onStoreSuccess`: log or notify after successful writes
 */
export abstract class AbstractEventStore<EventType extends Event = Event>
  implements BaseEventStore<EventType>
{
  constructor(protected readonly repository: EventRepository) {}

  // ---------------------------------------------------------------------------
  // Hook methods – override in subclasses to customize behavior
  // ---------------------------------------------------------------------------

  /**
   * Transforms events before deduplication.
   * Called after recordToEvent mapping, before deduplicateEvents.
   * Default: identity (returns events as-is).
   * Memory override: sort by timestamp + deep clone.
   *
   * Sorting before dedup ensures the earliest event is kept when duplicates exist.
   */
  protected postProcessEvents(events: EventType[]): EventType[] {
    return events;
  }

  /**
   * Wraps an operation in an instrumentation span.
   * Default: executes the function directly without instrumentation.
   * ClickHouse override: wraps with OpenTelemetry tracer.
   */
  protected async instrument<T>(
    _name: string,
    _attributes: Record<string, string | number>,
    fn: () => Promise<T>,
  ): Promise<T> {
    return await fn();
  }

  /**
   * Logs an error with structured context.
   * Default: no-op.
   * ClickHouse override: structured logger call.
   */
  protected logError(
    _name: string,
    _context: Record<string, unknown>,
    _error: unknown,
  ): void {
    // no-op by default
  }

  /**
   * Called after events are successfully stored.
   * Default: no-op.
   * ClickHouse override: logs info with tenant/counts.
   */
  protected onStoreSuccess(
    _context: EventStoreReadContext<EventType>,
    _events: readonly EventType[],
  ): void {
    // no-op by default
  }

  // ---------------------------------------------------------------------------
  // Concrete template methods
  // ---------------------------------------------------------------------------

  async getEvents(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): Promise<readonly EventType[]> {
    EventUtils.validateTenantId(context, `${this.constructor.name}.getEvents`);

    return await this.instrument(
      `${this.constructor.name}.getEvents`,
      {
        "aggregate.id": String(aggregateId),
        "tenant.id": context.tenantId,
        "aggregate.type": aggregateType,
      },
      async () => {
        try {
          const records = await this.repository.getEventRecords(
            context.tenantId,
            aggregateType,
            aggregateId,
          );

          const events = records.map((record) =>
            recordToEvent<EventType>(record, aggregateId),
          );

          const processed = this.postProcessEvents(events);
          return deduplicateEvents(processed);
        } catch (error) {
          this.logError(`${this.constructor.name}.getEvents`, {
            aggregateId: String(aggregateId),
            tenantId: context.tenantId,
            aggregateType,
          }, error);
          throw error;
        }
      },
    );
  }

  async getEventsUpTo(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    upToEvent: EventType,
  ): Promise<readonly EventType[]> {
    EventUtils.validateTenantId(
      context,
      `${this.constructor.name}.getEventsUpTo`,
    );

    return await this.instrument(
      `${this.constructor.name}.getEventsUpTo`,
      {
        "aggregate.id": String(aggregateId),
        "tenant.id": context.tenantId,
        "aggregate.type": aggregateType,
        "up_to.event_id": upToEvent.id,
        "up_to.timestamp": upToEvent.timestamp,
      },
      async () => {
        try {
          const records = await this.repository.getEventRecordsUpTo(
            context.tenantId,
            aggregateType,
            aggregateId,
            upToEvent.timestamp,
            upToEvent.id,
          );

          const events = records.map((record) =>
            recordToEvent<EventType>(record, aggregateId),
          );

          const processed = this.postProcessEvents(events);
          return deduplicateEvents(processed);
        } catch (error) {
          this.logError(`${this.constructor.name}.getEventsUpTo`, {
            aggregateId: String(aggregateId),
            tenantId: context.tenantId,
            aggregateType,
            upToEventId: upToEvent.id,
            upToTimestamp: upToEvent.timestamp,
          }, error);
          throw error;
        }
      },
    );
  }

  async countEventsBefore(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    beforeTimestamp: number,
    beforeEventId: string,
  ): Promise<number> {
    EventUtils.validateTenantId(
      context,
      `${this.constructor.name}.countEventsBefore`,
    );

    return await this.instrument(
      `${this.constructor.name}.countEventsBefore`,
      {
        "aggregate.id": String(aggregateId),
        "tenant.id": context.tenantId,
        "aggregate.type": aggregateType,
        "before.timestamp": beforeTimestamp,
        "before.event_id": beforeEventId,
      },
      async () => {
        try {
          return await this.repository.countEventRecords(
            context.tenantId,
            aggregateType,
            aggregateId,
            beforeTimestamp,
            beforeEventId,
          );
        } catch (error) {
          this.logError(`${this.constructor.name}.countEventsBefore`, {
            aggregateId: String(aggregateId),
            tenantId: context.tenantId,
            aggregateType,
            beforeTimestamp,
            beforeEventId,
          }, error);
          throw error;
        }
      },
    );
  }

  async storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
  ): Promise<void> {
    return await this.instrument(
      `${this.constructor.name}.storeEvents`,
      {
        "tenant.id": context.tenantId,
        "event.count": events.length,
        "aggregate.type": aggregateType,
      },
      async () => {
        try {
          EventUtils.validateTenantId(
            context,
            `${this.constructor.name}.storeEvents`,
          );

          if (events.length === 0) {
            return;
          }

          // Validate all events before storage
          for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (!event) {
              throw new ValidationError(
                `Event at index ${i} is undefined`,
                "event",
                void 0,
                { index: i },
              );
            }
            validateEventTenant(event, context, i);
            validateEventAggregateType(event, aggregateType, i);
            if (!EventUtils.isValidEvent(event)) {
              throw new ValidationError(
                `Invalid event at index ${i}: event must have id, aggregateId, timestamp, type, and data`,
                "event",
                event,
                { index: i },
              );
            }
          }

          // Transform events to records
          const records = events.map((event) => eventToRecord(event));

          // Delegate to repository
          await this.repository.insertEventRecords(records);

          this.onStoreSuccess(context, events);
        } catch (error) {
          this.logError(`${this.constructor.name}.storeEvents`, {
            tenantId: context.tenantId,
            eventCount: events.length,
            aggregateIds: [
              ...new Set(events.map((e) => String(e.aggregateId))),
            ],
          }, error);
          throw error;
        }
      },
    );
  }
}

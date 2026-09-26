import type { AggregateType } from "../domain/aggregateType.ts";
import type { Event } from "../domain/types.ts";
import { ValidationError } from "../services/errorHandling.ts";
import { EventUtils } from "../utils/event.utils.ts";
import type {
  EventStore as BaseEventStore,
  EventStoreEventReadInput,
  EventStoreReadContext,
} from "./eventStore.types.ts";
import {
  deduplicateEvents,
  eventToRecord,
  recordToEvent,
  validateEventAggregateType,
  validateEventTenant,
} from "./eventStoreUtils.ts";
import { rehydrationLowerBoundMs } from "./rehydrationWindow.ts";
import type { EventRecord, EventRepository } from "./repositories/eventRepository.types.ts";

/**
 * Abstract base with template-method skeleton; subclasses customize via hooks like
 * postProcessEvents, instrument, logError, and onStoreSuccess.
 */
export abstract class AbstractEventStore<
  EventType extends Event = Event,
> implements BaseEventStore<EventType> {
  constructor(protected readonly repository: EventRepository) {}

  // ---------------------------------------------------------------------------
  // Hook methods – override in subclasses to customize behavior
  // ---------------------------------------------------------------------------

  /**
   * Transforms events before deduplication (after recordToEvent mapping).
   * Default: identity. Memory override sorts by timestamp + deep clones, so
   * dedup keeps the earliest of any duplicates.
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
    return fn();
  }

  /**
   * Logs an error with structured context.
   * Default: no-op.
   * ClickHouse override: structured logger call.
   */
  protected logError(_name: string, _context: Record<string, unknown>, _error: unknown): void {
    // no-op by default
  }

  /**
   * Logs a warning with structured context.
   * Default: no-op.
   * ClickHouse override: structured logger call.
   */
  protected logWarning(_name: string, _context: Record<string, unknown>, _message: string): void {
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

  /**
   * Enrichment hook; ClickHouse override stamps _retention_days from tenant policy.
   */
  protected async enrichRecordsForStorage(
    records: EventRecord[],
    _context: EventStoreReadContext<EventType>,
  ): Promise<EventRecord[]> {
    return records;
  }

  // ---------------------------------------------------------------------------
  // Concrete template methods
  // ---------------------------------------------------------------------------

  /**
   * Empty aggregate ID is a caller bug; reading it seeks the empty-id key range and crashes
   * production. Short-circuit to an empty stream instead.
   */
  private hasMissingAggregateId(aggregateId: string): boolean {
    return String(aggregateId).trim().length === 0;
  }

  async getEvent(input: EventStoreEventReadInput): Promise<EventType> {
    const operation = `${this.constructor.name}.getEvent`;
    const { eventId, tenantId, aggregateType, aggregateId } = input;
    const context = { tenantId };
    EventUtils.validateTenantId(context, operation);

    if (eventId.trim().length === 0 || this.hasMissingAggregateId(aggregateId)) {
      throw new ValidationError(
        "An event read requires a non-empty eventId and aggregateId",
        "eventId",
        eventId,
      );
    }

    return this.instrument(
      operation,
      {
        "aggregate.id": aggregateId,
        "aggregate.type": aggregateType,
        "event.id": eventId,
        "tenant.id": context.tenantId,
      },
      async () => {
        const record = await this.repository.getEventRecord({
          tenantId: context.tenantId,
          aggregateType,
          aggregateId,
          eventId,
        });

        return recordToEvent<EventType>(record, aggregateId);
      },
    );
  }

  async getEvents(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    anchorOccurredAtMs?: number,
  ): Promise<readonly EventType[]> {
    // For time-local aggregate types, lower-bound the event_log scan to a
    // window around the triggering work's time so ClickHouse prunes old weekly
    // partitions instead of cold-scanning every partition on S3. Returns
    // undefined (unbounded scan) for long-lived aggregate types or when no
    // usable anchor time is available, so behaviour is unchanged there.
    return this.readEvents({
      operation: "getEvents",
      aggregateId,
      context,
      aggregateType,
      occurredAtFromMs: rehydrationLowerBoundMs(aggregateType, anchorOccurredAtMs),
    });
  }

  /**
   * Retrieves events with an explicit occurred-at lower bound; caller must provide sufficient
   * safety margin to avoid dropping delayed/replayed events.
   */
  async getEventsOccurredSince(
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    aggregateType: AggregateType,
    occurredAtFromMs: number,
  ): Promise<readonly EventType[]> {
    return this.readEvents({
      operation: "getEventsOccurredSince",
      aggregateId,
      context,
      aggregateType,
      occurredAtFromMs,
    });
  }

  private async readEvents({
    operation,
    aggregateId,
    context,
    aggregateType,
    occurredAtFromMs,
  }: {
    operation: "getEvents" | "getEventsOccurredSince";
    aggregateId: string;
    context: EventStoreReadContext<EventType>;
    aggregateType: AggregateType;
    occurredAtFromMs: number | undefined;
  }): Promise<readonly EventType[]> {
    const label = `${this.constructor.name}.${operation}`;
    EventUtils.validateTenantId(context, label);

    if (this.hasMissingAggregateId(aggregateId)) {
      this.logWarning(
        label,
        { tenantId: context.tenantId, aggregateType },
        "Skipped event_log read for an empty aggregateId (would scan the whole empty-id key range); returning no events",
      );
      return [];
    }

    return this.instrument(
      label,
      {
        "aggregate.id": String(aggregateId),
        "tenant.id": context.tenantId,
        "aggregate.type": aggregateType,
      },
      async () => {
        try {
          const records = await this.repository.getEventRecords({
            tenantId: context.tenantId,
            aggregateType,
            aggregateId,
            occurredAtFromMs,
          });

          const events = records.map((record) => recordToEvent<EventType>(record, aggregateId));

          const processed = this.postProcessEvents(events);
          return deduplicateEvents(processed);
        } catch (error) {
          this.logError(
            label,
            {
              aggregateId: String(aggregateId),
              tenantId: context.tenantId,
              aggregateType,
            },
            error,
          );
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
    EventUtils.validateTenantId(context, `${this.constructor.name}.getEventsUpTo`);

    if (this.hasMissingAggregateId(aggregateId)) {
      this.logWarning(
        `${this.constructor.name}.getEventsUpTo`,
        { tenantId: context.tenantId, aggregateType },
        "Skipped event_log read for an empty aggregateId (would scan the whole empty-id key range); returning no events",
      );
      return [];
    }

    return this.instrument(
      `${this.constructor.name}.getEventsUpTo`,
      {
        "aggregate.id": String(aggregateId),
        "tenant.id": context.tenantId,
        "aggregate.type": aggregateType,
        "up_to.event_id": upToEvent.id,
        "up_to.timestamp": upToEvent.createdAt,
      },
      async () => {
        try {
          const records = await this.repository.getEventRecordsUpTo({
            tenantId: context.tenantId,
            aggregateType,
            aggregateId,
            upToTimestamp: upToEvent.createdAt,
            upToEventId: upToEvent.id,
            // Anchor on the triggering event's own occurred time. For a
            // time-local aggregate every sibling event falls inside its
            // lifetime, so a 45-day window can't exclude one.
            // `rehydrationLowerBoundMs` returns undefined for long-lived types.
            occurredAtFromMs: rehydrationLowerBoundMs(aggregateType, upToEvent.occurredAt),
          });

          const events = records.map((record) => recordToEvent<EventType>(record, aggregateId));

          const processed = this.postProcessEvents(events);
          return deduplicateEvents(processed);
        } catch (error) {
          this.logError(
            `${this.constructor.name}.getEventsUpTo`,
            {
              aggregateId: String(aggregateId),
              tenantId: context.tenantId,
              aggregateType,
              upToEventId: upToEvent.id,
              upToTimestamp: upToEvent.createdAt,
            },
            error,
          );
          throw error;
        }
      },
    );
  }

  async getEventsUpToPaged(request: {
    aggregateId: string;
    context: EventStoreReadContext<EventType>;
    aggregateType: AggregateType;
    upToEvent: EventType;
    after: { timestamp: number; eventId: string } | undefined;
    limit: number;
  }): Promise<readonly EventType[]> {
    const { aggregateId, context, aggregateType } = request;
    EventUtils.validateTenantId(context, `${this.constructor.name}.getEventsUpToPaged`);

    if (this.hasMissingAggregateId(aggregateId)) {
      this.logWarning(
        `${this.constructor.name}.getEventsUpToPaged`,
        { tenantId: context.tenantId, aggregateType },
        "Skipped event_log read for an empty aggregateId (would scan the whole empty-id key range); returning no events",
      );
      return [];
    }

    const pagedRead = this.repository.getEventRecordsUpToPaged;
    if (!pagedRead) {
      throw new Error(
        `${this.constructor.name}: the event repository does not implement getEventRecordsUpToPaged; a paginated re-fold cannot be served`,
      );
    }

    return this.readEventsUpToPagedFromRepository(pagedRead, request);
  }

  /**
   * Instrumented repository call + row-to-event mapping for
   * {@link getEventsUpToPaged}, split out so the public method only carries
   * validation and capability-checking.
   */
  private async readEventsUpToPagedFromRepository(
    pagedRead: NonNullable<EventRepository["getEventRecordsUpToPaged"]>,
    request: {
      aggregateId: string;
      context: EventStoreReadContext<EventType>;
      aggregateType: AggregateType;
      upToEvent: EventType;
      after: { timestamp: number; eventId: string } | undefined;
      limit: number;
    },
  ): Promise<readonly EventType[]> {
    const { aggregateId, context, aggregateType, upToEvent, after, limit } = request;
    return this.instrument(
      `${this.constructor.name}.getEventsUpToPaged`,
      {
        "aggregate.id": String(aggregateId),
        "tenant.id": context.tenantId,
        "aggregate.type": aggregateType,
        "up_to.event_id": upToEvent.id,
        "page.limit": limit,
      },
      async () => {
        try {
          const records = await pagedRead.call(this.repository, {
            tenantId: context.tenantId,
            aggregateType,
            aggregateId,
            upToTimestamp: upToEvent.createdAt,
            upToEventId: upToEvent.id,
            after,
            limit,
            // Same bound as the unpaged read. It matters MORE here: without it
            // every page re-opens every partition, so the cost is paid once per
            // page rather than once per re-fold.
            occurredAtFromMs: rehydrationLowerBoundMs(aggregateType, upToEvent.occurredAt),
          });

          const events = records.map((record) => recordToEvent<EventType>(record, aggregateId));

          // Do NOT dedup here: `deduplicateEvents` can drop the raw page's
          // last row (a retry sharing an idempotencyKey with an earlier row),
          // which would feed a stale cursor (re-reading forever) and make a
          // full page look short — mistaken for exhaustion. The caller's
          // cross-page `seen` set reproduces the same effect safely.
          return this.postProcessEvents(events);
        } catch (error) {
          this.logError(
            `${this.constructor.name}.getEventsUpToPaged`,
            {
              aggregateId: String(aggregateId),
              tenantId: context.tenantId,
              aggregateType,
              upToEventId: upToEvent.id,
              limit,
            },
            error,
          );
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
    EventUtils.validateTenantId(context, `${this.constructor.name}.countEventsBefore`);

    if (this.hasMissingAggregateId(aggregateId)) {
      this.logWarning(
        `${this.constructor.name}.countEventsBefore`,
        { tenantId: context.tenantId, aggregateType },
        "Skipped event_log count for an empty aggregateId (would scan the whole empty-id key range); returning 0",
      );
      return 0;
    }

    return this.instrument(
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
          return await this.repository.countEventRecords({
            tenantId: context.tenantId,
            aggregateType,
            aggregateId,
            beforeTimestamp,
            beforeEventId,
          });
        } catch (error) {
          this.logError(
            `${this.constructor.name}.countEventsBefore`,
            {
              aggregateId: String(aggregateId),
              tenantId: context.tenantId,
              aggregateType,
              beforeTimestamp,
              beforeEventId,
            },
            error,
          );
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
    return this.instrument(
      `${this.constructor.name}.storeEvents`,
      {
        "tenant.id": context.tenantId,
        "event.count": events.length,
        "aggregate.type": aggregateType,
      },
      async () => {
        try {
          EventUtils.validateTenantId(context, `${this.constructor.name}.storeEvents`);

          if (events.length === 0) {
            return;
          }

          // Validate all events before storage
          for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (!event) {
              throw new ValidationError(`Event at index ${i} is undefined`, "event", void 0, {
                index: i,
              });
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

          // Transform events to records, then apply optional per-batch
          // enrichment (e.g. retention stamping) before handing to the repo.
          const baseRecords = events.map((event) => eventToRecord(event));
          const records = await this.enrichRecordsForStorage(baseRecords, context);

          // Delegate to repository
          await this.repository.insertEventRecords(records);

          this.onStoreSuccess(context, events);
        } catch (error) {
          this.logError(
            `${this.constructor.name}.storeEvents`,
            {
              tenantId: context.tenantId,
              eventCount: events.length,
              aggregateIds: [...new Set(events.map((e) => String(e.aggregateId)))],
            },
            error,
          );
          throw error;
        }
      },
    );
  }
}

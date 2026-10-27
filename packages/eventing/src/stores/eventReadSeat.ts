import { Ksuid } from "@langwatch/ksuid";

import type { AggregateType } from "../domain/aggregateType.ts";
import type { TenantId } from "../domain/tenantId.ts";
import type { Event } from "../domain/types.ts";
import { incrementEventLogIndexRead } from "../metrics.ts";
import { EventNotFoundError, ValidationError } from "../services/errorHandling.ts";
import { EventUtils } from "../utils/event.utils.ts";
import type { EventStoreEventReadInput } from "./eventStore.types.ts";
import { deduplicateEvents, recordToEvent } from "./eventStoreUtils.ts";
import type {
  EventOccurredAtWindow,
  EventRecord,
  EventRepository,
} from "./repositories/eventRepository.types.ts";

/**
 * Half-width of the first read's EventOccurredAt window, seven days: a KSUID's time and the row's
 * occurred time usually sit within queue lag of each other; a miss falls back to the whole stream
 * (dev/docs/plans/id-index-2026-10-10.md §4).
 */
export const EVENT_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** One tenant's aggregate stream, named whole. */
export interface AggregateEventsReadInput {
  tenantId: TenantId;
  aggregateType: AggregateType;
  aggregateId: string;
}

/**
 * Reads beside a store that may refuse every read (Q209, 2026-10-06): one event by id, and one
 * aggregate's stream for identity's history panels and SCIM's sync activity (WEB-9103, 2026-10-10).
 * Spec: packages/eventing/specs/event-read-seat.feature.
 */
export interface EventReadSeat<EventType extends Event = Event> {
  getEvent(input: EventStoreEventReadInput): Promise<EventType>;
  /** The stream oldest first; an empty aggregate id answers none rather than scanning. */
  findAggregateEvents(input: AggregateEventsReadInput): Promise<readonly EventType[]>;
}

type SeatRepository = Pick<EventRepository, "getEventRecord" | "getEventRecords">;

/** The seat over an event repository, bounded to the window around the id's KSUID time. */
export class EventLogReadSeat<EventType extends Event = Event> implements EventReadSeat<EventType> {
  static create<EventType extends Event = Event>(options: {
    repository: SeatRepository;
  }): EventLogReadSeat<EventType> {
    return new EventLogReadSeat<EventType>(options.repository);
  }

  private constructor(private readonly repository: SeatRepository) {}

  async getEvent(input: EventStoreEventReadInput): Promise<EventType> {
    const { eventId, tenantId, aggregateType, aggregateId } = input;
    EventUtils.validateTenantId({ tenantId }, "EventLogReadSeat.getEvent");
    const missingEventId = eventId.trim().length === 0;
    const missingAggregateId = String(aggregateId).trim().length === 0;
    if (missingEventId || missingAggregateId) {
      throw new ValidationError({
        reason: "An event read requires a non-empty eventId and aggregateId",
        field: "eventId",
        value: eventId,
      });
    }

    const record = await readEventRecord({
      repository: this.repository,
      tenantId,
      aggregateType,
      aggregateId,
      eventId,
    });
    return recordToEvent<EventType>(record, aggregateId);
  }

  async findAggregateEvents(input: AggregateEventsReadInput): Promise<readonly EventType[]> {
    const { tenantId, aggregateType, aggregateId } = input;
    EventUtils.validateTenantId({ tenantId }, "EventLogReadSeat.findAggregateEvents");
    if (String(aggregateId).trim().length === 0) return [];
    const records = await this.repository.getEventRecords({ tenantId, aggregateType, aggregateId });
    return deduplicateEvents(
      records.map((record) => recordToEvent<EventType>(record, aggregateId)),
    );
  }
}

/**
 * One event by id: first within the window its KSUID's time names, then, on a miss, today's read
 * of the whole stream, counted as a fallback, unless the first read already covered the stream.
 * An id carrying no time takes today's read at once.
 */
export async function readEventRecord({
  repository,
  tenantId,
  aggregateType,
  aggregateId,
  eventId,
}: {
  repository: Pick<EventRepository, "getEventRecord">;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventId: string;
}): Promise<EventRecord> {
  const stream = { tenantId, aggregateType, aggregateId, eventId };
  const occurredAt = eventReadWindow({ eventId });
  if (occurredAt === null) {
    incrementEventLogIndexRead({ read: "event", outcome: "not_ksuid" });
    return repository.getEventRecord(stream);
  }
  try {
    const record = await repository.getEventRecord({ ...stream, occurredAt });
    incrementEventLogIndexRead({ read: "event", outcome: "window_hit" });
    return record;
  } catch (error) {
    if (!(error instanceof EventNotFoundError) || error.wholeStream) throw error;
    incrementEventLogIndexRead({ read: "event", outcome: "window_fallback" });
    return repository.getEventRecord(stream);
  }
}

/** Seven days either side of the time a KSUID id carries; null when the id carries none. */
export function eventReadWindow({ eventId }: { eventId: string }): EventOccurredAtWindow | null {
  let createdAtMs: number;
  try {
    createdAtMs = Ksuid.parse(eventId).date.getTime();
  } catch {
    return null;
  }
  return {
    fromMs: Math.max(0, Math.floor(createdAtMs - EVENT_READ_WINDOW_MS)),
    toMs: Math.floor(createdAtMs + EVENT_READ_WINDOW_MS),
  };
}

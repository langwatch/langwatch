import { createTenantId, type EventReadSeat } from "@langwatch/eventing";

import {
  eventPayloadSchema,
  findEventPayloadField,
} from "../../rules/trace-event-log-payload.rules.ts";
import {
  TraceEventPayloadFieldNotFoundError,
  TracePayloadReaderRepository,
} from "../trace-payload-reader.repository.ts";

/** Every offloaded trace field is recorded on the trace aggregate; no other is asked. */
const TRACE_AGGREGATE_TYPE = "trace";

/** The one read this repository takes off the seat. */
type TraceEventReads = Pick<EventReadSeat, "getEvent">;

/**
 * One offloaded field out of the trace event that recorded it, read through eventing's
 * one-event seat (Q209). Spec: modules/trace/specs/trace-offloaded-event-read.feature.
 */
export class EventingTraceEventPayloadRepository extends TracePayloadReaderRepository {
  static create(deps: { eventReadSeat: TraceEventReads }): EventingTraceEventPayloadRepository {
    return new EventingTraceEventPayloadRepository(deps.eventReadSeat);
  }

  private constructor(private readonly eventReadSeat: TraceEventReads) {
    super();
  }

  async read(input: {
    tenantId: string;
    traceId: string;
    eventId: string;
    field: string;
  }): Promise<string> {
    const event = await this.eventReadSeat.getEvent({
      tenantId: createTenantId(input.tenantId),
      aggregateType: TRACE_AGGREGATE_TYPE,
      aggregateId: input.traceId,
      eventId: input.eventId,
    });
    const payload = eventPayloadSchema.safeParse(event.data);
    const value = payload.success ? findEventPayloadField(payload.data, input.field) : null;
    if (value === null) {
      throw new TraceEventPayloadFieldNotFoundError(input.eventId, input.field);
    }

    return value;
  }
}

import type { AppendStore, Event, MapProjectionDefinition } from "@langwatch/eventing";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  spanReceivedMeteringDataSchema,
} from "@langwatch/trace-contract";

import type { TraceMeterRecord } from "../repositories/trace-meter.repository.ts";
import { UsageCountingService } from "../services/usage-counting.service.ts";

/** Frozen once landed: the peer lane is `entitlement.usageTraceMeter`, its replay step's lane. */
export const TRACE_METER_PROJECTION_NAME = "usageTraceMeter";

/** Trace's fact the meter maps: its type and trace's narrow metering schema, not the whole span. */
export const TRACE_METER_EVENT = {
  type: SPAN_RECEIVED_EVENT_TYPE,
  data: spanReceivedMeteringDataSchema,
} as const;

/** One meter row per span: a peer map over trace's span_received, whose aggregate is the trace. */
export class TraceMeterProjection {
  static create(store: AppendStore<TraceMeterRecord>): TraceMeterProjection {
    return new TraceMeterProjection(store);
  }

  private constructor(private readonly store: AppendStore<TraceMeterRecord>) {}

  /** One lane per event: two rows for one trace collapse on read. */
  static groupKey(event: Event): string {
    return `usage-trace-meter:${event.id}`;
  }

  static map(event: Event): TraceMeterRecord {
    return {
      organizationId: "", // resolved by the store
      tenantId: String(event.tenantId),
      traceId: String(event.aggregateId),
      month: UsageCountingService.monthOf(event.createdAt),
    };
  }

  build(): MapProjectionDefinition<TraceMeterRecord, Event> {
    return {
      name: TRACE_METER_PROJECTION_NAME,
      eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
      options: { groupKeyFn: (event: Event) => TraceMeterProjection.groupKey(event) },
      map: (event: Event) => TraceMeterProjection.map(event),
      store: this.store,
    };
  }
}

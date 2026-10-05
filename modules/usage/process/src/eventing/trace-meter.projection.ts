import type { AppendStore, Event, MapProjectionDefinition } from "@langwatch/eventing";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";

import type { TraceMeterRecord } from "../repositories/trace-meter.repository.ts";
import { UsageCountingService } from "../services/usage-counting.service.ts";

/** Frozen once landed: the name is half of the routing key `global:handler:usageTraceMeter`. */
export const TRACE_METER_PROJECTION_NAME = "usageTraceMeter";

/** One trace meter row per span; a span_received event's aggregate is its trace. */
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

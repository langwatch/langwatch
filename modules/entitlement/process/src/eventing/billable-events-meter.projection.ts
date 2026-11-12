import type { AppendStore, Event, MapProjectionDefinition } from "@langwatch/eventing";
import { METRIC_DATA_POINT_RECEIVED_EVENT_TYPE } from "@langwatch/metric-contract";
import { toEpochMs } from "@langwatch/time";

import type { BillableEventRecord } from "../repositories/billable-events-meter.repository.ts";
import { BILLABLE_EVENT_TYPES, metricSeriesHourKey } from "../rules/billable-event.rules.ts";

/**
 * Frozen: the name is half of the routing key `global:handler:orgBillableEventsMeter`, so
 * a rename leaves queued jobs unroutable and stalls every billable event unnoticed.
 */
export const BILLABLE_EVENTS_METER_PROJECTION_NAME = "orgBillableEventsMeter";

/**
 * One billable row per billable event, across every pipeline, so the month reads one table.
 * The store resolves the organization and writes through its organization-keyed ClickHouse
 * client, so a private-instance customer's rows stay on their own cluster.
 */
export class BillableEventsMeterProjection {
  static create(store: AppendStore<BillableEventRecord>): BillableEventsMeterProjection {
    return new BillableEventsMeterProjection(store);
  }

  private constructor(private readonly store: AppendStore<BillableEventRecord>) {}

  /** One lane per event, because two rows for one event deduplicate on read. */
  static groupKey(event: Event): string {
    return `billing:${event.id}`;
  }

  /**
   * A metric point's key is its series and receive hour, so a series bills once an hour.
   * Otherwise the producer's `idempotencyKey` where set (an evaluation's is
   * `${tenantId}:${evaluationId}:reported`, billed once however often reported), else `event.id`.
   */
  static deduplicationKey(event: Event): string {
    if (event.type === METRIC_DATA_POINT_RECEIVED_EVENT_TYPE) {
      const seriesHour = metricSeriesHourKey({
        tenantId: String(event.tenantId),
        data: event.data,
        receivedAtMs: toEpochMs(event.createdAt),
      });
      if (seriesHour.outcome === "keyed") return seriesHour.key;
    }
    return event.idempotencyKey ?? event.id;
  }

  build(): MapProjectionDefinition<BillableEventRecord, Event> {
    return {
      name: BILLABLE_EVENTS_METER_PROJECTION_NAME,
      // `lw.evaluation.reported` is the only evaluation event production emits; `scheduled`
      // and `started` occur only in test presets (issue #5124) and are not subscribed.
      eventTypes: [...BILLABLE_EVENT_TYPES],

      options: {
        // Wrapped rather than passed bare: a bare static-method reference
        // trips `typescript/unbound-method` even though `groupKey` never
        // reads `this`.
        groupKeyFn: (event: Event) => BillableEventsMeterProjection.groupKey(event),
      },

      map: (event: Event): BillableEventRecord => ({
        organizationId: "", // resolved by the store
        tenantId: String(event.tenantId),
        eventId: event.id,
        eventType: event.type,
        deduplicationKey: BillableEventsMeterProjection.deduplicationKey(event),
        eventTimestamp: event.createdAt,
      }),

      store: this.store,
    };
  }
}

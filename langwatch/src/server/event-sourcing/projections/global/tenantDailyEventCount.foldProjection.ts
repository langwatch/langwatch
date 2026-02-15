import { createLogger } from "~/utils/logger/server";
import type { Event } from "../../library/domain/types";
import type { FoldProjectionDefinition, FoldProjectionStore } from "../../library/projections/foldProjection.types";
import { EVALUATION_STARTED_EVENT_TYPE } from "../../pipelines/evaluation-processing/schemas/constants";
import { SPAN_RECEIVED_EVENT_TYPE } from "../../pipelines/trace-processing/schemas/constants";
import type { ProjectionStoreContext } from "../../library/projections/projectionStoreContext";

const logger = createLogger("langwatch:projections:tenant-daily-billable-events");

export const TENANT_DAILY_BILLABLE_EVENTS_PROJECTION_VERSION = "2025-02-14" as const;

export interface TenantDailyBillableEventsState {
  tenantId: string;
  date: string;
  count: number;
}

function toUTCDateString(timestampMs: number): string {
  return new Date(timestampMs).toISOString().split("T")[0]!;
}

/**
 * In-memory store for tenant daily billable event counts.
 * Keyed by `${tenantId}:${date}`.
 */
class InMemoryTenantDailyBillableEventsStore implements FoldProjectionStore<TenantDailyBillableEventsState> {
  private readonly state = new Map<string, TenantDailyBillableEventsState>();

  async store(state: TenantDailyBillableEventsState, context: ProjectionStoreContext): Promise<void> {
    const key = context.key ?? context.aggregateId;
    this.state.set(key, state);
    logger.debug(
      { tenantId: state.tenantId, date: state.date, count: state.count },
      "Tenant daily billable event count updated",
    );
  }

  async get(aggregateId: string, _context: ProjectionStoreContext): Promise<TenantDailyBillableEventsState | null> {
    return this.state.get(aggregateId) ?? null;
  }

  /** Expose the internal state for testing/debugging. */
  getAll(): Map<string, TenantDailyBillableEventsState> {
    return new Map(this.state);
  }
}

export const tenantDailyBillableEventsStore = new InMemoryTenantDailyBillableEventsStore();

/**
 * Global fold projection that counts billable events per tenant per day.
 *
 * Billable events: span_received (trace ingestion) and evaluation_started.
 *
 * - key: tenantId:date — groups by tenant and UTC calendar day, not by aggregateId
 * - registered globally — receives events from all pipelines
 */
export const tenantDailyBillableEventsProjection: FoldProjectionDefinition<TenantDailyBillableEventsState, Event> = {
  name: "tenantDailyBillableEvents",
  version: TENANT_DAILY_BILLABLE_EVENTS_PROJECTION_VERSION,
  eventTypes: [SPAN_RECEIVED_EVENT_TYPE, EVALUATION_STARTED_EVENT_TYPE],

  key: (event) => `${String(event.tenantId)}:${toUTCDateString(event.timestamp)}`,

  init: () => ({ tenantId: "", date: "", count: 0 }),

  apply(state, event) {
    return {
      tenantId: String(event.tenantId),
      date: toUTCDateString(event.timestamp),
      count: state.count + 1,
    };
  },

  store: tenantDailyBillableEventsStore,
};

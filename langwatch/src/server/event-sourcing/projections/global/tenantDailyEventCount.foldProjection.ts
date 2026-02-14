import { createLogger } from "~/utils/logger/server";
import type { Event } from "../../library/domain/types";
import type { FoldProjectionDefinition, FoldProjectionStore } from "../../library/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../library/projections/projectionStoreContext";

const logger = createLogger("langwatch:projections:tenant-daily-event-count");

export interface TenantDailyEventCountState {
  tenantId: string;
  date: string;
  count: number;
}

function toDateString(timestampMs: number): string {
  return new Date(timestampMs).toISOString().split("T")[0]!;
}

/**
 * In-memory store for tenant daily event counts.
 * Logs every update for visibility. Keyed by `${tenantId}:${date}`.
 */
class InMemoryTenantDailyEventCountStore implements FoldProjectionStore<TenantDailyEventCountState> {
  private readonly state = new Map<string, TenantDailyEventCountState>();

  async store(state: TenantDailyEventCountState, context: ProjectionStoreContext): Promise<void> {
    const key = context.key ?? context.aggregateId;
    this.state.set(key, state);
    logger.info(
      { tenantId: state.tenantId, date: state.date, count: state.count },
      "Tenant daily event count updated",
    );
  }

  async get(aggregateId: string, _context: ProjectionStoreContext): Promise<TenantDailyEventCountState | null> {
    return this.state.get(aggregateId) ?? null;
  }

  /** Expose the internal state for testing/debugging. */
  getAll(): Map<string, TenantDailyEventCountState> {
    return new Map(this.state);
  }
}

export const tenantDailyEventCountStore = new InMemoryTenantDailyEventCountStore();

/**
 * Global fold projection that counts events per tenant per day.
 *
 * - key: tenantId:date — groups by tenant and calendar day, not by aggregateId
 * - registered globally — receives events from all pipelines
 */
export const tenantDailyEventCountProjection: FoldProjectionDefinition<TenantDailyEventCountState, Event> = {
  name: "tenantDailyEventCount",
  eventTypes: [], // empty = all event types

  key: (event) => `${String(event.tenantId)}:${toDateString(event.timestamp)}`,

  init: () => ({ tenantId: "", date: "", count: 0 }),

  apply(state, event) {
    return {
      tenantId: String(event.tenantId),
      date: toDateString(event.timestamp),
      count: state.count + 1,
    };
  },

  store: tenantDailyEventCountStore,
};

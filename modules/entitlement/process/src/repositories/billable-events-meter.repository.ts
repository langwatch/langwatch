/** One deduplicated billable event, as the meter projection produces it. */
export interface BillableEventRecord {
  organizationId: string;
  tenantId: string;
  eventId: string;
  eventType: string;
  deduplicationKey: string;
  eventTimestamp: number;
}

/** One event type of an organization's meter. */
export type EventTypeFilter = Readonly<{
  organizationId: string;
  eventType: string;
}>;

/** A `[start, end)` window as ClickHouse `DateTime64(3)` literals. */
export type MeterWindow = Readonly<{ startDate: string; endDate: string }>;

/** One named project's distinct billable events in a window. */
export type ProjectMeterCount = { projectId: string; count: number };

/** One UTC day's distinct billable events: `day` is `YYYY-MM-DD`. */
export type DayMeterCount = { day: string; count: number };

/** The `billable_events` table, keyed by organization so private instances keep their cluster. */
export abstract class BillableEventsMeterRepository {
  abstract insert(input: { record: BillableEventRecord; organizationId: string }): Promise<void>;
  /** Distinct deduplication keys the organization was metered for in the window. */
  abstract findTotal(input: { organizationId: string } & MeterWindow): Promise<number>;
  /** Approximate distinct keys per named project; a project with none is absent. */
  abstract countByProjects(input: {
    organizationId: string;
    projectIds: readonly string[];
    window: MeterWindow;
  }): Promise<ProjectMeterCount[]>;
  /** Distinct keys of one event type in the window. */
  abstract countEventType(input: EventTypeFilter & MeterWindow): Promise<number>;
  /** Whether the project was already metered under this deduplication key. */
  abstract hasDeduplicationKey(input: {
    organizationId: string;
    projectId: string;
    deduplicationKey: string;
  }): Promise<boolean>;
  /** Epoch ms of the earliest matching event of one type; null when it has none. */
  abstract findFirstEventAt(input: EventTypeFilter): Promise<number | null>;
  /** Approximate distinct keys per UTC day across the named projects; a day with none is absent. */
  abstract countByDay(input: {
    organizationId: string;
    projectIds: readonly string[];
    window: MeterWindow;
  }): Promise<DayMeterCount[]>;
}

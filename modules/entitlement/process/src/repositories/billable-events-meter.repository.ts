/** One deduplicated billable event, as the meter projection produces it. */
export interface BillableEventRecord {
  organizationId: string;
  tenantId: string;
  eventId: string;
  eventType: string;
  deduplicationKey: string;
  eventTimestamp: number;
}

/** A `[start, end)` window as ClickHouse `DateTime64(3)` literals. */
export type MeterWindow = Readonly<{ startDate: string; endDate: string }>;

/** One named project's distinct billable events in a window. */
export type ProjectMeterCount = { projectId: string; count: number };

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
}

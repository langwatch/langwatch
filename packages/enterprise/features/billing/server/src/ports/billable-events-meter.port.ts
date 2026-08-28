// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The WRITE side of `billable_events`, kept apart from the read side in
 * `billable-events.port.ts` on purpose.
 *
 * Both used to be called `BillableEventsRepository` — one here, one in the app
 * — so the App's dependency list imported the name twice and had to alias one
 * of them (`BillingEventsReadRepository`) to tell them apart. They are not two
 * views of one port: the meter appends one deduplicated row per billable event
 * as it happens, while the reader aggregates a billing month. Naming them apart
 * is what stops a future change wiring the meter where a rollup was meant.
 */

/** One deduplicated billable event, as the meter projection produces it. */
export interface BillableEventRecord {
  organizationId: string;
  tenantId: string;
  eventId: string;
  eventType: string;
  deduplicationKey: string;
  eventTimestamp: number;
}

/**
 * Appends billable events for deduplicated usage counting.
 *
 * Organization-scoped rather than tenant-scoped: billing routes ClickHouse per
 * organization (private-instance customers get their own), and the caller has
 * already resolved the organization for the tenant before this is reached.
 */
export abstract class BillableEventsMeterPort {
  /** Inserts one deduplicated billable-event row. */
  abstract insert(input: { record: BillableEventRecord; organizationId: string }): Promise<void>;
}

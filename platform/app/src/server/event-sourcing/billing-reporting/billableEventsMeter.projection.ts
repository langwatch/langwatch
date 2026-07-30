import { deriveAppendMapping } from "@langwatch/clickhouse";
import {
  type BillableEventRecorded,
  billableEventRecordedSchema,
} from "./events";
import { billableEventsTable } from "./table";

/** The map's whole job: the event's payload already is the row (ADR-105
 *  decision 5) — `recordBillableEvent` resolved the organization once, at the
 *  trust boundary, so nothing here does a lookup. */
export function toBillableEventRow(
  data: BillableEventRecorded,
): BillableEventRecorded {
  return data;
}

/** `fill` names the one column the event's own fields cannot produce: the
 *  `ReplacingMergeTree` version, stamped once per write. */
export const toBillableEventsTableRow = deriveAppendMapping<
  BillableEventRecorded,
  typeof billableEventsTable.columns
>({
  table: billableEventsTable,
  record: billableEventRecordedSchema,
  fill: { UpdatedAt: () => new Date() },
});

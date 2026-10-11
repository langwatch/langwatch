/** Private persistence port for filling the event log's aggregate index from older events. */
import type { IdIndexFillReport, IdIndexOwnerFill } from "@langwatch/clickhouse-client";

export abstract class EventLogIdIndexFillRepository {
  /** Fills the index on every target, raises its retention there, then writes its marker. */
  abstract fill(input: IdIndexOwnerFill): Promise<IdIndexFillReport>;
}

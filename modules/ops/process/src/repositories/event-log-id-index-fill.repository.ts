/** Private persistence port for filling the event log's aggregate index from older events. */
import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";

export abstract class EventLogIdIndexFillRepository {
  /** Fills the index on every target, then runs `beforeFlag` and `setFlag` on each. */
  abstract fill(
    input: Omit<FillIdIndexesOptions, "statements" | "targets" | "indexes">,
  ): Promise<IdIndexFillReport>;

  /** The indexes whose rows copy the event log's retention, which data-retention raises. */
  abstract indexesWithCopiedRetention(): string[];
}

/** Private persistence port for filling the id indexes from rows older than their views. */
import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";

export abstract class GatewayIdIndexFillRepository {
  /** Fills every declared index on every target, then runs `beforeFlag` and `setFlag` on each. */
  abstract fill(
    input: Omit<FillIdIndexesOptions, "statements" | "targets" | "indexes">,
  ): Promise<IdIndexFillReport>;
}

/** Private persistence port for the module's id indexes: their fill, and whether they are ready. */
import type {
  IdIndexFillReport,
  IdIndexFlags,
  IdIndexOwnerFill,
} from "@langwatch/clickhouse-client";

export abstract class GatewayIdIndexFillRepository {
  /** Fills every declared index on every target, raises its retention, then writes its markers. */
  abstract fill(input: IdIndexOwnerFill): Promise<IdIndexFillReport>;

  /** Whether the module's id indexes are ready on a target, answered from memory. */
  abstract readonly readiness: IdIndexFlags;
}

import type { RetentionDaysProvider } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import {
  RETENTION_TABLE_CATEGORY_MAP,
  type RetentionManagedTable,
} from "@langwatch/data-retention-contract/retention-tables";

/**
 * The app's retention policy, in the shape the ClickHouse floor asks for. The floor owns the
 * mechanism (arithmetic, the never-narrower guarantee, the cache) and none of the policy; this is
 * the whole policy half — map the table to its category, ask the cascade.
 */
export class TraceRetentionFloorService implements RetentionDaysProvider {
  static create(resolver: DataRetentionApi): TraceRetentionFloorService {
    return new TraceRetentionFloorService(resolver);
  }

  private constructor(private readonly resolver: DataRetentionApi) {}

  async findRetentionDays({
    tenantId,
    table,
  }: {
    tenantId: string;
    table: string;
  }): Promise<number[]> {
    const category = RETENTION_TABLE_CATEGORY_MAP[table as RetentionManagedTable];
    if (!category) {
      return [];
    }

    const resolved = await this.resolver.getResolvedForProject({ projectId: tenantId });
    const days = resolved[category];

    return typeof days === "number" ? [days] : [];
  }
}

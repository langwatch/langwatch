import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import {
  RETENTION_TABLE_CATEGORY_MAP,
  type RetentionManagedTable,
} from "@langwatch/data-retention-contract/retention-tables";

import type { EvaluationRetentionLookup } from "../app/evaluation.members.ts";

type Retention = Pick<DataRetentionApi, "getPlatformDefaultRetentionDays" | "getRetentionDays">;

/**
 * The policy half of the run read's floor: map the table to its category, ask data retention.
 * The ClickHouse read owns the mechanism (margin, cache, the fallback), as trace's floor does.
 */
export class EvaluationRetentionDaysService implements EvaluationRetentionLookup {
  static create(retention: Retention): EvaluationRetentionDaysService {
    return new EvaluationRetentionDaysService(retention);
  }

  private constructor(private readonly retention: Retention) {}

  getPlatformDefaultRetentionDays(): number {
    return this.retention.getPlatformDefaultRetentionDays();
  }

  async findRetentionDays({
    tenantId,
    table,
  }: {
    tenantId: string;
    table: string;
  }): Promise<number[]> {
    if (!isManagedTable(table)) return [];
    const days = await this.retention.getRetentionDays({
      projectId: tenantId,
      category: RETENTION_TABLE_CATEGORY_MAP[table],
    });
    return [days];
  }
}

function isManagedTable(table: string): table is RetentionManagedTable {
  return Object.hasOwn(RETENTION_TABLE_CATEGORY_MAP, table);
}

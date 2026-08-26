import {
  type RetentionDaysProvider,
  RetentionFloorService,
} from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import {
  RETENTION_TABLE_CATEGORY_MAP,
  type RetentionManagedTable,
} from "@langwatch/data-retention-server/retention-tables";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";

const logger = createLogger("langwatch:clickhouse:retention-floor");

/**
 * The app's retention policy, in the shape the ClickHouse package asks for.
 *
 * The package owns the mechanism — floor arithmetic, the never-narrower
 * guarantee, the cache — and deliberately owns none of the policy. This is the
 * whole of the policy half: map the table to its retention category and ask
 * the project cascade.
 */
class PlatformRetentionDaysProvider implements RetentionDaysProvider {
  constructor(private readonly resolver: DataRetentionService) {}

  async getRetentionDays({
    tenantId,
    table,
  }: {
    tenantId: string;
    table: string;
  }): Promise<number | null> {
    const category = RETENTION_TABLE_CATEGORY_MAP[table as RetentionManagedTable];
    if (!category) return null;

    const resolved = await this.resolver.getResolvedForProject({ projectId: tenantId });
    return resolved[category];
  }
}

/**
 * A floor service bound to this platform's retention policy.
 *
 * Pass no resolver and every read still gets a bound, at the platform default
 * — so a caller can adopt this before its construction site is rewired.
 */
export function createRetentionFloorService(
  resolver?: DataRetentionService,
): RetentionFloorService {
  return new RetentionFloorService({
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    provider: resolver ? new PlatformRetentionDaysProvider(resolver) : undefined,
    logger,
  });
}

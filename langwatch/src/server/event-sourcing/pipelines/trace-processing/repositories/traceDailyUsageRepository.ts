import type { ProjectDailyUsage } from "@prisma/client";

/**
 * Repository for trace daily usage operations.
 * Provides idempotent operations for tracking daily trace counts per tenant.
 */
export interface TraceDailyUsageRepository {
  /**
   * Ensures a trace is counted exactly once for the tenant-day.
   * Idempotent - safe to call multiple times for the same trace.
   *
   * @param tenantId - The tenant identifier
   * @param traceId - The trace identifier
   * @param date - The date (time portion ignored)
   * @returns true if this was the first time counting this trace, false if already counted
   */
  ensureTraceCounted(
    tenantId: string,
    traceId: string,
    date: Date,
  ): Promise<boolean>;

  /**
   * Gets the current usage for a tenant-day.
   */
  getUsage(tenantId: string, date: Date): Promise<ProjectDailyUsage | null>;
}

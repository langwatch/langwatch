import type { PrismaClient } from "@prisma/client";

/**
 * Check if the ClickHouse read path is enabled for evaluations data.
 *
 * ClickHouse is now always the primary data source — this always returns true.
 * Kept for API compatibility with callers.
 */
export async function isClickHouseReadEnabled(
  _prisma: PrismaClient,
  _projectId: string,
): Promise<boolean> {
  return true;
}

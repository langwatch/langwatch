import type { PrismaClient } from "@prisma/client";

export type ElasticSearchWriteDomain =
  | "traces"
  | "evaluations"
  | "simulations";

/**
 * Elasticsearch writes are always disabled — ClickHouse is the primary store.
 * Kept for API compatibility with callers.
 */
export async function isElasticSearchWriteDisabled(
  _prisma: PrismaClient,
  _projectId: string,
  _domain: ElasticSearchWriteDomain,
): Promise<boolean> {
  return true;
}

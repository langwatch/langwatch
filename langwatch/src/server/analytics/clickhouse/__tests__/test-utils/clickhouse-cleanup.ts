/**
 * ClickHouse test-data cleanup utilities for analytics integration tests.
 *
 * The shared `cleanupTestData` helper does not cover the `evaluation_runs`
 * table, so analytics tests that seed it are responsible for removing their own
 * rows in `afterAll`.
 */

import type { ClickHouseClient } from "@clickhouse/client";

/**
 * Delete every `evaluation_runs` row for a tenant, synchronously.
 *
 * Takes the wrapped client (`wrapWithDefaultSettings`) so cleanup carries the
 * same default settings as the queries under test, rather than the bare client.
 * Always runs with `mutations_sync = 1` so the mutation finishes before the next
 * test file starts, preventing cross-file `evaluation_runs` bleed. A nullish
 * client is a no-op so a failed `beforeAll` does not mask its own error with a
 * teardown crash.
 */
export async function deleteEvaluationRunsByTenant({
  client,
  tenantId,
}: {
  client: ClickHouseClient | null | undefined;
  tenantId: string;
}): Promise<void> {
  if (!client) return;

  await client.exec({
    query: `ALTER TABLE evaluation_runs DELETE WHERE TenantId = {tenantId:String} SETTINGS mutations_sync = 1`,
    query_params: { tenantId },
  });
}

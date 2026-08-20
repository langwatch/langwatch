import { getClickHouseClientForTenant } from "~/server/clickhouse/clickhouseClient";
import type { LwqlKeyMapRow } from "./productionProvisioning";

/**
 * The one place runtime code writes the LangWatchQL key-map table.
 *
 * A repository rather than a client in the caller: the client access boundary
 * (`src/server/clickhouse/__tests__/clientAccessBoundary.unit.test.ts`) keeps
 * construction in `managedClient.ts` and resolution behind repositories, so a
 * key-map write gets the shared client's statement limit, retries and metrics
 * instead of a bare driver client with none of them. The deploy-time backfill
 * in `src/tasks/provisionLwql.ts` does NOT come through here — it runs before
 * the app (and its shared client) exists, on a per-run admin client of its
 * own, which the boundary test names as a construction site.
 *
 * Resolved per tenant rather than from the shared client: a project whose
 * organization has a private ClickHouse instance keeps its LangWatchQL views
 * and its key map on that instance, so a row written to the shared one would
 * leave that project's access unreachable while looking like it succeeded.
 */
export async function insertLwqlKeyMapRow({
  table,
  row,
}: {
  /** Already mode-qualified via `lwqlKeyMapTableQualifiedName`. */
  table: string;
  row: LwqlKeyMapRow;
}): Promise<void> {
  const client = await getClickHouseClientForTenant(row.TenantId);
  if (!client) {
    throw new Error(
      "ClickHouse is not configured (CLICKHOUSE_URL) — cannot write the LangWatchQL key-map row",
    );
  }
  await client.insert({
    table,
    values: [row],
    format: "JSONEachRow",
    // Waited-on async insert: the row must be readable by the row-filter
    // subquery before the project's first LangWatchQL query, but many
    // project-creates may land at once.
    clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
  });
}

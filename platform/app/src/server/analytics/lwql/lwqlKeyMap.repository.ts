import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { LwqlKeyMapRow } from "./productionProvisioning";

/**
 * The one place runtime code writes the LangWatchQL key-map table.
 *
 * A repository holding an injected resolver rather than a client of its own:
 * ClickHouse access has two doors (`__tests__/clientImportBoundary.unit.test.ts`
 * and `__tests__/clientAccessBoundary.unit.test.ts`) — the composition root
 * builds the resolver, everything else receives one — so a key-map write gets
 * the managed client's statement limit, retries and metrics instead of a bare
 * driver client with none of them.
 *
 * Resolved per tenant rather than from the shared client: a project whose
 * organization has a private ClickHouse instance keeps its LangWatchQL views
 * and its key map on that instance, so a row written to the shared one would
 * leave that project's access unreachable while the insert reported success.
 *
 * The deploy-time backfill in `src/tasks/provisionLwql.ts` does NOT come
 * through here — it runs before the app (and its resolver) exists, on a
 * per-run admin client of its own, which the access boundary names as a
 * construction site.
 */
export interface LwqlKeyMapRepository {
  insertRow(input: { table: string; row: LwqlKeyMapRow }): Promise<void>;
}

export class LwqlKeyMapClickHouseRepository implements LwqlKeyMapRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  /** @param table Already mode-qualified via `lwqlKeyMapTableQualifiedName`. */
  async insertRow({
    table,
    row,
  }: {
    table: string;
    row: LwqlKeyMapRow;
  }): Promise<void> {
    const client = await this.resolveClient(row.TenantId);
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
}

/**
 * For presets with no datastore. Refuses rather than silently succeeding: a
 * key map that accepted writes and kept none is the failure mode the deploy
 * backfill exists to prevent, and the caller already treats a throw as
 * "the scheduled backfill will pick it up".
 */
export class NullLwqlKeyMapRepository implements LwqlKeyMapRepository {
  insertRow(): Promise<void> {
    return Promise.reject(
      new Error(
        "No ClickHouse in this preset — the LangWatchQL key-map row was not written",
      ),
    );
  }
}

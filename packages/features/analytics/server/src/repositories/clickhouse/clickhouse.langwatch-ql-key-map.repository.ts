import type { LwqlKeyMapRow } from "../../langwatch-ql/productionProvisioning";
import type { ClickHouseClientResolver } from "./clickhouse.filter-options.repository";

/**
 * The one place runtime code writes the LangWatchQL key-map table.
 *
 * A repository holding an injected resolver rather than a client of its own:
 * ClickHouse access has two doors — the composition root
 * builds the resolver, everything else receives one — so a key-map write gets
 * the managed client's statement limit, retries and metrics instead of a bare
 * driver client with none of them.
 *
 * Resolved per tenant rather than from the shared client: a project whose
 * organization has a private ClickHouse instance keeps its LangWatchQL views
 * and its key map on that instance, so a row written to the shared one would
 * leave that project's access unreachable while the insert reported success.
 *
 * The deploy-time backfill does NOT come through here — it runs before any
 * application (and its resolver) exists, on a per-run admin client of its own,
 * which the access boundary names as a construction site.
 */
/**
 * The key-map insert contract, in one place because two paths write this table:
 * this repository at project-create and the deploy backfill task. Waited-on
 * async insert — the row must be
 * readable by the row-filter subquery before the project's first LangWatchQL
 * query, but many project-creates may land at once.
 */
export const LWQL_KEY_MAP_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
} as const;

export interface LwqlKeyMapRepository {
  insertRow(input: { table: string; row: LwqlKeyMapRow }): Promise<void>;
}

export class LwqlKeyMapClickHouseRepository implements LwqlKeyMapRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  /** @param table Already mode-qualified via `lwqlKeyMapTableQualifiedName`. */
  async insertRow({ table, row }: { table: string; row: LwqlKeyMapRow }): Promise<void> {
    const client = await this.resolveClient(row.TenantId);
    await client.insert({
      table,
      values: [row],
      format: "JSONEachRow",
      clickhouse_settings: LWQL_KEY_MAP_INSERT_SETTINGS,
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

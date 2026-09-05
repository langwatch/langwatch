import type { LwqlKeyMapRow } from "../../langwatch-ql/production-provisioning";
import type { ClickHouseClientResolver } from "./clickhouse.filter-options.repository";
import { LwqlKeyMapRepository } from "../langwatch-ql-key-map.repository";

/**
 * The key-map insert contract, shared because two paths write this table:
 * this repository at project-create and the deploy backfill task. Waited-on
 * async insert — the row must be readable before the project's first query.
 */
export const LWQL_KEY_MAP_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
} as const;

/**
 * The one place runtime code writes the LangWatchQL key-map table.
 */
export class LwqlKeyMapClickHouseRepository extends LwqlKeyMapRepository {
  private constructor(private readonly resolveClient: ClickHouseClientResolver) {
    super();
  }

  static create(options: {
    resolveClient: ClickHouseClientResolver;
  }): LwqlKeyMapClickHouseRepository {
    return new LwqlKeyMapClickHouseRepository(options.resolveClient);
  }

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
 * For presets with no datastore. Refuses rather than silently succeeding: a key map that
 * accepted writes and kept none is the failure mode the deploy backfill exists to prevent,
 * and the caller already treats a throw as "the scheduled backfill will pick it up".
 */
export class NullLwqlKeyMapRepository extends LwqlKeyMapRepository {
  static create(): NullLwqlKeyMapRepository {
    return new NullLwqlKeyMapRepository();
  }

  insertRow(): Promise<void> {
    return Promise.reject(
      new Error("No ClickHouse in this preset — the LangWatchQL key-map row was not written"),
    );
  }
}

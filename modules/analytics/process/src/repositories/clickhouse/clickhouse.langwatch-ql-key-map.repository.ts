import type { LwqlKeyMapRow } from "../../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import { LwqlKeyMapRepository } from "../langwatch-ql-key-map.repository.ts";
import type { ClickHouseClientResolver } from "./clickhouse.filter-options.repository.ts";

/**
 * The key-map insert contract, shared because two paths write this table:
 * this repository at project-create and the deploy backfill task. Waited-on
 * async insert — the row must be readable before the project's first query.
 */
export const LWQL_KEY_MAP_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
} as const;

const LWQL_KEY_MAP_TABLE = "lwql_api_key_tenant_map";

/**
 * The one place runtime code writes the LangWatchQL key-map table, qualified
 * with the app's own database (`sourceDatabase`).
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

  async insertRow({
    row,
    sourceDatabase,
  }: {
    row: LwqlKeyMapRow;
    sourceDatabase: string;
  }): Promise<void> {
    const client = await this.resolveClient(row.TenantId);
    await client.insert({
      table: `${sourceDatabase}.${LWQL_KEY_MAP_TABLE}`,
      // A fresh literal, not `row` itself: `LwqlKeyMapRow` names its two
      // columns rather than an index signature, so it does not satisfy the
      // session's `Record<string, unknown>` row shape on its own.
      values: [{ KeyHash: row.KeyHash, TenantId: row.TenantId }],
      format: "JSONEachRow",
      clickhouse_settings: LWQL_KEY_MAP_INSERT_SETTINGS,
    });
  }
}

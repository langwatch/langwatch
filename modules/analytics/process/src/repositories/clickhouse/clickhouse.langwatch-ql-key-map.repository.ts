import type { LwqlKeyMapRow } from "../../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import { LwqlKeyMapRepository } from "../langwatch-ql-key-map.repository.ts";
import type { ClickHouseAdminStatements } from "../langwatch-ql-provisioning.repository.ts";

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
 * The one place runtime code writes the LangWatchQL key-map table, qualified with the app's own
 * database (`sourceDatabase`). Through the LangWatchQL admin target, as the deploy backfill does:
 * never a tenant's routed client, which can be a server the customer controls (ADR-200).
 */
export class LwqlKeyMapClickHouseRepository extends LwqlKeyMapRepository {
  private constructor(private readonly statements: ClickHouseAdminStatements) {
    super();
  }

  static create({
    statements,
  }: {
    statements: ClickHouseAdminStatements;
  }): LwqlKeyMapClickHouseRepository {
    return new LwqlKeyMapClickHouseRepository(statements);
  }

  async insertRow({
    row,
    sourceDatabase,
  }: {
    row: LwqlKeyMapRow;
    sourceDatabase: string;
  }): Promise<void> {
    await this.statements.insert({
      table: `${sourceDatabase}.${LWQL_KEY_MAP_TABLE}`,
      rows: [{ KeyHash: row.KeyHash, TenantId: row.TenantId }],
      settings: LWQL_KEY_MAP_INSERT_SETTINGS,
    });
  }
}

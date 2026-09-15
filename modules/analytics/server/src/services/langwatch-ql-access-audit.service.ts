/**
 * LangWatchQL analytics SQL — the queries that prove the access model holds.
 * @see ./langwatch-ql-access-model.service.ts — the model these audit
 */
import { clickHouseLiteral } from "../rules/langwatch-ql-sql-literal.rules.ts";
import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "./langwatch-ql-access-model.service.ts";

const accessModel = LangWatchQLAccessModelService.create();

/** The audit queries the isolation proof suite runs against a live server. */
export class LangWatchQLAccessAuditService {
  static create(): LangWatchQLAccessAuditService {
    return new LangWatchQLAccessAuditService();
  }

  private constructor() {}

  /**
   * Audits the LangWatchQL database for views that would void the model. A view declared `SQL
   * SECURITY DEFINER` reads its source tables as its definer, not as the caller, so row
   * policies do not apply to it.
   */
  definerViewAuditQuery({ names }: { names: LangWatchQLNames }): string {
    accessModel.assertNames(names);

    return (
      `SELECT name, engine, create_table_query\n` +
      `FROM system.tables\n` +
      `WHERE database = ${clickHouseLiteral(names.database)}\n` +
      `  AND engine LIKE '%View'\n` +
      `  AND (positionCaseInsensitive(create_table_query, 'SQL SECURITY DEFINER') > 0\n` +
      `       OR engine = 'MaterializedView')`
    );
  }

  /**
   * Audits row-policy coverage from the server rather than from a hand-written list: every
   * object the restricted identity holds a `SELECT` grant on must be scoped to one tenant, in
   * one of exactly two ways.
   */
  policyCoverageQuery({ names }: { names: LangWatchQLNames }): string {
    accessModel.assertNames(names);
    const user = clickHouseLiteral(names.restrictedUser);

    return (
      `SELECT\n` +
      `  t.database AS database,\n` +
      `  t.name AS table,\n` +
      `  (t.database, t.name) IN (\n` +
      `    SELECT database, table FROM system.row_policies\n` +
      `    WHERE has(apply_to_list, ${user})\n` +
      `  ) AS has_policy,\n` +
      `  (t.engine = 'View'\n` +
      `   AND positionCaseInsensitive(t.create_table_query, 'SQL SECURITY INVOKER') > 0) AS is_invoker_view,\n` +
      `  (has_policy OR is_invoker_view) AS covered\n` +
      `FROM system.tables AS t\n` +
      `WHERE (t.database, t.name) IN (\n` +
      `    SELECT database, table FROM system.grants\n` +
      `    WHERE user_name = ${user}\n` +
      `      AND access_type = 'SELECT'\n` +
      `      AND database IS NOT NULL\n` +
      `      AND table IS NOT NULL\n` +
      `  )\n` +
      `ORDER BY database, table`
    );
  }

  /**
   * How ClickHouse renders a custom setting's value when it is read back from `system.settings`
   * or from `system.query_log.Settings`.
   */
  auditedSettingValue(value: string): string {
    return `'${value}'`;
  }

  /**
   * Audits that no dictionary in the LangWatchQL database serves tenant-scoped data.
   * Dictionaries are not subject to row policies, so any tenant-scoped dictionary reachable by
   * the restricted identity is a bypass — the reason the key map is a self-policed table.
   */
  dictionaryAuditQuery({ names }: { names: LangWatchQLNames }): string {
    accessModel.assertNames(names);

    return (
      `SELECT name FROM system.dictionaries ` +
      `WHERE database = ${clickHouseLiteral(names.database)}`
    );
  }
}

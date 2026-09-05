/**
 * LangWatchQL analytics SQL — the queries that prove the access model holds.
 *
 * Read by the isolation proof suite and by operations: each one reports the
 * offenders of one invariant, and an empty result is the healthy state. They
 * run as an administrative identity, because the restricted one cannot read
 * `system.*` beyond its own grants.
 *
 * @see ./langwatch-ql-access-model.service.ts — the model these audit
 */
import { clickHouseLiteral } from "../rules/langwatch-ql-sql-literal.rules";
import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "./langwatch-ql-access-model.service";

const accessModel = LangWatchQLAccessModelService.create();

/** The audit queries the isolation proof suite runs against a live server. */
export class LangWatchQLAccessAuditService {
  static create(): LangWatchQLAccessAuditService {
    return new LangWatchQLAccessAuditService();
  }

  private constructor() {}

  /**
   * Audits the LangWatchQL database for views that would void the model.
   *
   * A view declared `SQL SECURITY DEFINER` reads its source tables as its definer,
   * not as the caller, so row policies do not apply to it. Measured against
   * 25.10.2.65: a `DEFINER` view over a policed table returned *both* tenants'
   * rows to the restricted identity. No LangWatchQL view may be `DEFINER`, and a
   * `MATERIALIZED VIEW` defaults to `DEFINER`, so both are reported.
   *
   * Returns rows of `{ name, engine, create_table_query }` for every offending
   * view; an empty result is the healthy state. Run as an administrative user —
   * the restricted identity cannot read `system.tables` beyond its own grants.
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
   * Audits row-policy coverage from the server rather than from a hand-written
   * list: every object the restricted identity holds a `SELECT` grant on must be
   * scoped to one tenant, in one of exactly two ways.
   *
   * Grants are the definition of "exposed", so adding a LangWatchQL object and
   * granting it without scoping it turns this red with no test edit. Deliberately
   * spans every database rather than only the LangWatchQL one: the LangWatchQL views
   * are `INVOKER` views over the application's own fact tables, so the grants
   * that matter most sit *outside* the LangWatchQL database, and an audit scoped to
   * that database would have reported a clean server while the real exposure went
   * unexamined.
   *
   * The two ways an object can be scoped:
   *
   *  - `has_policy` — a row policy on the object itself, applying to this
   *    identity. Every source table.
   *  - `is_invoker_view` — a normal view carrying an explicit
   *    `SQL SECURITY INVOKER`, which reads its sources as the caller and is
   *    therefore bounded by *their* policies. The carve-out is tight on purpose:
   *    a `DEFINER` view has no such clause and a `MATERIALIZED VIEW` is a
   *    different engine, so neither qualifies, and both are separately reported
   *    by {@link definerViewAuditQuery}.
   *
   * Intersected with `system.tables` on purpose: measured against 25.10.2.65, a
   * `SELECT` grant OUTLIVES the `DROP TABLE` of its object, so grants alone would
   * report long-dead objects as uncovered exposure. An object that no longer
   * exists exposes nothing.
   *
   * Returns rows of `{ database, table, has_policy, is_invoker_view, covered }`,
   * each flag being ClickHouse's UInt8 0/1. Run as an administrative user.
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
   * How ClickHouse renders a custom setting's value when it is read back from
   * `system.settings` or from `system.query_log.Settings`.
   *
   * Measured against 25.10.2.65: both surfaces return the *field-dumped* form —
   * `'0f1e2d…'`, single quotes included — not the bare value that was sent. An
   * audit that compares those columns against the raw hash silently never
   * matches, and reads as "the hash was not recorded".
   *
   * Correct for the hex digests this model uses; a value containing a quote or a
   * backslash would additionally be escaped by the dump.
   */
  auditedSettingValue(value: string): string {
    return `'${value}'`;
  }

  /**
   * Audits that no dictionary in the LangWatchQL database serves tenant-scoped data.
   *
   * Dictionaries are not subject to row policies, so any tenant-scoped dictionary
   * reachable by the restricted identity is a bypass — the reason the key map is
   * a self-policed table. See {@link lwqlKeyMapTableStatement}.
   *
   * Returns rows of `{ name }`; an empty result is the healthy state.
   */
  dictionaryAuditQuery({ names }: { names: LangWatchQLNames }): string {
    accessModel.assertNames(names);

    return (
      `SELECT name FROM system.dictionaries ` +
      `WHERE database = ${clickHouseLiteral(names.database)}`
    );
  }
}

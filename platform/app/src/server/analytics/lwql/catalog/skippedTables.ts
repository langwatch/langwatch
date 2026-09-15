/**
 * The tables the derived-dataset catalog deliberately leaves off.
 *
 * The catalog is opt-*out*: {@link ./defineDatasetFromTable#deriveDefaultCatalog}
 * turns every ClickHouse table into a dataset unless it is hand-written or named
 * here. That way a new customer-facing table cannot silently stay off the
 * catalog — the coverage guard fails until it is either catalogued or given a
 * reason to be skipped. A reason is required for every skip, so "not exposed" is
 * always a recorded decision rather than an oversight.
 *
 * Two shapes of skip: an exact table name in {@link LWQL_CATALOG_SKIPPED_TABLES},
 * and a family match in {@link matchesSkipPattern} for tables whose whole prefix
 * or suffix is bookkeeping ({@link skipReason} consults both).
 */

/**
 * Tables skipped by exact name, each with the reason it carries no customer
 * analytics.
 */
export const LWQL_CATALOG_SKIPPED_TABLES: Record<string, string> = {
  event_log: "internal event bookkeeping, not customer analytics",
  lwql_api_key_tenant_map:
    "the tenant key map the row policy reads; exposing it would leak the isolation mechanism",
  stored_log_records:
    "raw stored log payloads; the customer-facing shape is the log_records dataset",
  stored_metric_records:
    "raw stored metric payloads; the customer-facing shape is the metric datasets",
  log_usage_estimates: "billing usage bookkeeping, not customer analytics",
  metric_usage_estimates: "billing usage bookkeeping, not customer analytics",
  goose_db_version:
    "the goose migration-version table, engine-internal tooling state",
};

/**
 * The reason a table is skipped by family, or `undefined` when no family
 * matches.
 *
 *  - `governance_*` — governance bookkeeping, internal to the platform.
 *  - `*_mv` / materialised-view internals — engine plumbing, not a table a
 *    caller would query.
 */
export function matchesSkipPattern(table: string): string | undefined {
  if (table.startsWith("governance_")) {
    return "governance bookkeeping, internal to the platform";
  }
  if (table.endsWith("_mv") || table.includes(".inner")) {
    return "materialised-view internal, not a customer-facing table";
  }
  return undefined;
}

/**
 * The reason a table is off the derived catalog, or `undefined` if it should be
 * catalogued. Consults the exact map first, then the family patterns.
 */
export function skipReason(
  table: string,
  skip: Record<string, string> = LWQL_CATALOG_SKIPPED_TABLES,
): string | undefined {
  return skip[table] ?? matchesSkipPattern(table);
}

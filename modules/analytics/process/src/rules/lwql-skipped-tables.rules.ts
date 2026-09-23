/** The tables the derived-view catalog deliberately leaves off. */

/**
 * Tables skipped by exact name, each with the reason it carries no customer
 * analytics.
 */
export const LWQL_CATALOG_SKIPPED_TABLES: Record<string, string> = {
  lwql_api_key_tenant_map:
    "access-control plumbing, not customer telemetry — holds key hashes the " +
    "row policy reads to self-filter; the policy already scopes it, so " +
    "exposing it would leak the isolation mechanism for no customer benefit",
  goose_db_version:
    "the goose migration-version table, engine-internal tooling state — no " +
    "tenant column at all",
  instant_eval_runs:
    "the state of an Instant Eval run while it is running: its progress, its " +
    "spend and the statement it was started from. Read through the runs API, " +
    "which is where a run is started and watched; what the run produced is " +
    "the judgments dataset",
};

/** The reason a table is skipped by family, or `undefined` when no family matches. */
export function matchesSkipPattern(table: string): string | undefined {
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

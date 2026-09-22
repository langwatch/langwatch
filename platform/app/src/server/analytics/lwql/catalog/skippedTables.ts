/**
 * The tables the derived-view catalog deliberately leaves off.
 *
 * The catalog is opt-*out*: {@link ./defineDatasetFromTable#deriveDefaultCatalog}
 * turns every ClickHouse table into a view unless it is hand-written or named
 * here. That way a new customer-facing table cannot silently stay off the
 * catalog — the coverage guard fails until it is either catalogued or given a
 * reason to be skipped. A reason is required for every skip, so "not exposed" is
 * always a recorded decision rather than an oversight.
 *
 * All customer-owned data is exposed by default — a skip is warranted only
 * when the table (a) carries no tenant column at all, (b) is written under an
 * internal/system tenant that no customer project can ever hold rows under,
 * (c) is a materialised-view or `.inner` target whose data is already exposed
 * through the table it feeds, or (d) is access-control plumbing that adds
 * nothing beyond what the row policy already does. "Raw" or "legacy" shape is
 * not by itself a reason — those tables move to the derived catalog (with an
 * explicit override name where the default would collide) rather than being
 * skipped.
 *
 * Two shapes of skip: an exact table name in {@link LWQL_CATALOG_SKIPPED_TABLES},
 * and a family match in {@link matchesSkipPattern} for tables whose whole prefix
 * or suffix is bookkeeping ({@link skipReason} consults both).
 *
 * `governance_*` is deliberately NOT a skip family: every row of those tables
 * is written under the org's hidden `internal_governance` project, so
 * visibility is a row-policy question, not a cataloguing one — see
 * `catalog/overrides/governance.ts`.
 */

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

/**
 * The reason a table is skipped by family, or `undefined` when no family
 * matches.
 *
 *  - `*_mv` / materialised-view internals — engine plumbing, not a table a
 *    caller would query; its data is already exposed through the table it
 *    feeds.
 */
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

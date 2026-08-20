/**
 * Every LWQL catalog view name — and every PostgreSQL-engine source table
 * name — becomes a ClickHouse object in a database that, wherever
 * LWQL_DATABASE is not pointed elsewhere, is the SAME database the
 * product's own tables live in (the cloud deploys both as `langwatch` — see
 * lwql.tf in langwatch-saas — deliberately, with no separate analytics
 * database; a deployment that does separate them makes this check
 * conservative, never unsafe). A catalog name that matches
 * a migration-created object is therefore a live collision: the infra-owned
 * bridge would `CREATE OR REPLACE VIEW` over a production table, and the
 * per-view grants would hand the restricted identity an unfiltered read of
 * it.
 *
 * That nearly shipped once: the batch-evaluations dataset was first named
 * `experiment_runs`, the name of migration 00002's experiment-run
 * aggregates table. This test reads the real migration files so the next
 * collision fails here, in the repo that owns the catalog, instead of at
 * terraform apply.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";
import { isPostgresResident } from "../catalog/types";

const MIGRATIONS_DIR = join(process.cwd(), "src/server/clickhouse/migrations");

/** Object names the migrations create (tables, views, materialized views). */
function migrationCreatedObjectNames(): Set<string> {
  const names = new Set<string>();
  // The `${CLICKHOUSE_DATABASE}.` qualifier is OPTIONAL: migration 00023
  // documents unqualified creation as the convention (statements run inside
  // the connection's database), so requiring the prefix would blind this
  // guard to exactly those objects. Anchored to line start after stripping
  // `--` comments, or prose like "CREATE TABLE IF NOT EXISTS makes this
  // migration idempotent" would invent an object named "makes".
  const createPattern =
    /^\s*CREATE\s+(?:TABLE|(?:MATERIALIZED\s+)?VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\$\{CLICKHOUSE_DATABASE\}\.)?([A-Za-z0-9_]+)/gim;
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    for (const match of sql.matchAll(createPattern)) {
      names.add(match[1]!.toLowerCase());
    }
  }
  return names;
}

describe("given the LWQL catalog and the ClickHouse migrations", () => {
  const migrationNames = migrationCreatedObjectNames();

  it("actually parsed the migrations (sanity floor)", () => {
    // If the regex or the path rots, this fails before the collision checks
    // can vacuously pass. The floor sits just under the real count (45+ as
    // of migration 00084) so partial regex rot is caught too, and the named
    // anchors pin both creation styles: qualified (experiment_runs,
    // trace_summaries) and unqualified (stored_objects, migration 00023).
    expect(migrationNames.size).toBeGreaterThan(40);
    expect(migrationNames.has("experiment_runs")).toBe(true);
    expect(migrationNames.has("trace_summaries")).toBe(true);
    expect(migrationNames.has("stored_objects")).toBe(true);
  });

  it("no catalog view name collides with a migration-created object", () => {
    const collisions = LWQL_VIEW_CATALOG.map((view) => view.name).filter(
      (name) => migrationNames.has(name.toLowerCase()),
    );
    expect(collisions).toEqual([]);
  });

  it("no PostgreSQL-engine source table name collides with a migration-created object", () => {
    const collisions = LWQL_VIEW_CATALOG.filter(isPostgresResident)
      .map((view) => view.sourceTable)
      .filter((name) => migrationNames.has(name.toLowerCase()));
    expect(collisions).toEqual([]);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TIME_PARTITIONED_TABLES } from "../cold-scan-detector";

/**
 * The cold-scan detector fails OPEN: `detectColdScan` only inspects tables
 * listed in {@link TIME_PARTITIONED_TABLES}, so a partitioned table missing from
 * that map is silently treated as un-partitioned and never flagged, however
 * expensively it is queried.
 *
 * That default cost real money and real availability: the map covered 11 of 35
 * partitioned tables, and the 24 missing ones included `trace_analytics` and
 * `trace_summaries`, whose unwindowed reads ran as undetected cold scans at
 * ~350/min against a ClickHouse already at its memory ceiling. The gap was
 * invisible precisely because the detector reported nothing.
 *
 * A comment saying "keep in sync" could not have caught that, so this parses the
 * migrations and asserts the map matches.
 */
describe("cold-scan detector coverage", () => {
  const migrationDir = resolve(
    process.cwd(),
    "src/server/clickhouse/migrations",
  );

  /**
   * Tables created and later dropped. Their CREATE still exists in history —
   * migrations are immutable — but they are gone, so the detector must not
   * carry them.
   */
  const DROPPED = new Set<string>(["gateway_activity_events"]);

  /**
   * Scratch/rebuild tables that mirror a live table's schema. Queried only by
   * the migration that builds them, never on a request path.
   */
  const NOT_ON_A_READ_PATH = new Set<string>([
    "gateway_budget_scope_totals_rebuild",
  ]);

  /** Every table whose Up section declares a PARTITION BY, mapped to it. */
  function partitionedTablesFromMigrations(): Map<string, string> {
    const found = new Map<string, string>();

    for (const file of readdirSync(migrationDir).sort()) {
      if (!file.endsWith(".sql")) continue;

      const raw = readFileSync(resolve(migrationDir, file), "utf-8");
      // Drop comment lines: a commented-out CREATE in a Down section is not a
      // live table, and counting it would demand coverage for something that
      // does not exist.
      const body = raw
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      const up = body.split("+goose Down")[0] ?? body;

      const createRe = /CREATE TABLE[^(]*?[.`]?(\w+)[\s`]*?\(/gi;
      let match: RegExpExecArray | null;
      while ((match = createRe.exec(up)) !== null) {
        const table = match[1];
        if (!table) continue;
        const tail = up.slice(match.index, match.index + 6000);
        const partitionBy = /PARTITION BY\s+([^\n]+)/i.exec(tail);
        if (partitionBy?.[1]) found.set(table, partitionBy[1].trim());
      }
    }

    return found;
  }

  describe("given a table is partitioned by a time expression", () => {
    /** @scenario Every partitioned table is known to the cold-scan detector */
    it("is listed in TIME_PARTITIONED_TABLES so its unpruned reads get flagged", () => {
      const partitioned = partitionedTablesFromMigrations();
      const known = new Set(Object.keys(TIME_PARTITIONED_TABLES));

      const uncovered = [...partitioned.keys()]
        .filter((table) => !known.has(table))
        .filter((table) => !DROPPED.has(table))
        .filter((table) => !NOT_ON_A_READ_PATH.has(table))
        .sort();

      expect(uncovered).toEqual([]);
    });

    /** @scenario The declared prune column actually appears in the PARTITION BY */
    it("declares a prune column the PARTITION BY expression really uses", () => {
      const partitioned = partitionedTablesFromMigrations();
      const wrong: string[] = [];

      for (const [table, columns] of Object.entries(TIME_PARTITIONED_TABLES)) {
        const expression = partitioned.get(table);
        if (!expression) continue;
        // At least one declared column must appear in the expression, else the
        // detector is looking for a predicate that could never prune anything.
        const anyMatches = (columns as readonly string[]).some((column) =>
          new RegExp(`\\b${column}\\b`, "i").test(expression),
        );
        if (!anyMatches) {
          wrong.push(`${table}: declares [${columns.join(", ")}], partitioned by ${expression}`);
        }
      }

      expect(wrong).toEqual([]);
    });
  });

  describe("given a table is listed in the detector", () => {
    /**
     * @scenario The map carries no table that is not partitioned
     *
     * A stale entry makes the detector demand a time predicate on a table that
     * cannot prune by one — noise that trains people to ignore the warning.
     */
    it("is a table that really is partitioned", () => {
      const partitioned = partitionedTablesFromMigrations();

      const notPartitioned = Object.keys(TIME_PARTITIONED_TABLES)
        .filter((table) => !partitioned.has(table))
        .sort();

      expect(notPartitioned).toEqual([]);
    });
  });
});

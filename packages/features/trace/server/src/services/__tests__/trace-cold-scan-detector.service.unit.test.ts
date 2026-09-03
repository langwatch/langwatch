import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TIME_PARTITIONED_TABLES } from "@langwatch/clickhouse-client";

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
const migrationDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../packages/clickhouse-client/migrations",
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
  "trace_analytics_rollup_rebuild",
  "evaluation_analytics_rollup_rebuild",
]);

/**
 * A migration's Up section, with `--` line comments removed.
 *
 * Order matters: split on the Down marker BEFORE stripping comments. The
 * marker is itself a comment line (`-- +goose Down`) in every migration, so
 * stripping first would delete it and leave `split` matching nothing — the
 * "Up section" would silently be the whole file, Down included.
 *
 * `--` comments go second because a commented-out CREATE is not a live table,
 * and counting it would demand coverage for something that does not exist.
 * Block comments are not stripped: no migration uses them, and every
 * commented-out CREATE in the tree is a `--` line.
 */
function upSectionOf(raw: string): string {
  const up = raw.split(/^\s*--\s*\+goose Down/m)[0] ?? raw;
  return up
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

/**
 * The single CREATE statement starting at `from`, ending at whichever comes
 * first: its terminating `;` or the next `CREATE TABLE`.
 *
 * A fixed-width window instead of a real boundary is what makes this test lie:
 * an unpartitioned table followed closely enough by a partitioned one would
 * pick up the neighbour's `PARTITION BY` and be recorded as partitioned. Every
 * assertion below would then pass against an entry describing a table that
 * cannot prune — the exact silent gap this file exists to close.
 */
function statementAt(up: string, from: number): string {
  const rest = up.slice(from);
  const semicolon = rest.indexOf(";");
  // Searched from index 1 so the match that opened this statement is skipped.
  const nextCreate = rest.slice(1).search(/CREATE\s+TABLE/i);

  return rest.slice(
    0,
    Math.min(
      semicolon === -1 ? rest.length : semicolon,
      nextCreate === -1 ? rest.length : nextCreate + 1,
    ),
  );
}

/** Tables one Up section creates with a PARTITION BY, mapped to it. */
function partitionedTablesIn(up: string): Map<string, string> {
  const found = new Map<string, string>();
  const createRe = /CREATE TABLE[^(]*?[.`]?(\w+)[\s`]*?\(/gi;

  let match: RegExpExecArray | null;
  while ((match = createRe.exec(up)) !== null) {
    const table = match[1];
    if (!table) continue;
    const partitionBy = /PARTITION BY\s+([^\n]+)/i.exec(statementAt(up, match.index));
    if (partitionBy?.[1]) found.set(table, partitionBy[1].trim());
  }

  return found;
}

/** Every table whose Up section declares a PARTITION BY, mapped to it. */
function partitionedTablesFromMigrations(): Map<string, string> {
  const found = new Map<string, string>();

  for (const file of readdirSync(migrationDir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const raw = readFileSync(resolve(migrationDir, file), "utf-8");
    for (const [table, expression] of partitionedTablesIn(upSectionOf(raw))) {
      found.set(table, expression);
    }
  }

  return found;
}

/**
 * At least one declared column must appear in the PARTITION BY expression,
 * else the detector is looking for a predicate that could never prune.
 */
function declaresAUsableColumn(columns: readonly string[], expression: string): boolean {
  return columns.some((column) => new RegExp(`\\b${column}\\b`, "i").test(expression));
}

/**
 * Entries whose declared columns appear nowhere in the table's real PARTITION
 * BY, rendered for the failure message.
 */
function pruneColumnMismatches(partitioned: ReadonlyMap<string, string>): string[] {
  return Object.entries(TIME_PARTITIONED_TABLES)
    .map(([table, columns]) => {
      const expression = partitioned.get(table);
      if (!expression) return null;
      if (declaresAUsableColumn(columns as readonly string[], expression)) {
        return null;
      }
      return `${table}: declares [${columns.join(", ")}], partitioned by ${expression}`;
    })
    .filter((entry): entry is string => entry !== null);
}

describe("cold-scan detector coverage", () => {
  describe("given a table is partitioned by a time expression", () => {
    /** @scenario The detector knows every table the schema partitions by time */
    it("is listed in TIME_PARTITIONED_TABLES so its unpruned reads get flagged", () => {
      const partitioned = partitionedTablesFromMigrations();
      // Guard against a vacuous pass: if the migration directory ever moved,
      // or the CREATE regex stopped matching, `partitioned` would be empty and
      // "nothing is uncovered" would be trivially true — the exact silent
      // failure this whole file exists to prevent.
      expect(partitioned.size).toBeGreaterThan(0);
      const known = new Set(Object.keys(TIME_PARTITIONED_TABLES));

      const uncovered = [...partitioned.keys()]
        .filter((table) => !known.has(table))
        .filter((table) => !DROPPED.has(table))
        .filter((table) => !NOT_ON_A_READ_PATH.has(table))
        .sort();

      expect(uncovered).toEqual([]);
    });

    /** @scenario The predicate the detector asks for is one that can prune */
    it("declares a prune column the PARTITION BY expression really uses", () => {
      const wrong = pruneColumnMismatches(partitionedTablesFromMigrations());

      expect(wrong).toEqual([]);
    });
  });

  describe("given a table is listed in the detector", () => {
    /*
     * A stale entry makes the detector demand a time predicate on a table that
     * cannot prune by one — noise that trains people to ignore the warning.
     */
    /** @scenario The detector never demands a predicate that cannot prune */
    it("is a table that really is partitioned", () => {
      const partitioned = partitionedTablesFromMigrations();

      const notPartitioned = Object.keys(TIME_PARTITIONED_TABLES)
        .filter((table) => !partitioned.has(table))
        .sort();

      expect(notPartitioned).toEqual([]);
    });
  });
});

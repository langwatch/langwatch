import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard: every column of an AggregatingMergeTree table declares how it merges.
 *
 * An AggregatingMergeTree collapses all rows that share a sorting key when it
 * merges parts. A column that is neither part of the sorting key nor an
 * aggregate state (AggregateFunction / SimpleAggregateFunction) has no rule for
 * that collapse: the surviving row keeps the value of whichever input row the
 * merge read last. The column still reads, so nothing at runtime reports it.
 *
 * ClickHouse 26.0 turned the same schema into a create-time error
 * (BAD_ARGUMENTS, "Column(s) X of the AggregatingMergeTree table are neither
 * part of the sorting key nor aggregate measures"). A migration run replays
 * every file from the start on a new install, so one such column stops a fresh
 * install against ClickHouse 26 or newer on that migration and leaves no schema
 * behind. Chart-managed ClickHouse is pinned, but an external ClickHouse is the
 * customer's own, and ClickHouse Cloud moves versions on its own schedule.
 *
 * SimpleAggregateFunction(max, T) is the fix: it states the rule the readers
 * already assume, is stored as the underlying type, and every supported
 * ClickHouse version accepts it.
 *
 * MATERIALIZED and ALIAS columns are exempt. They are computed on read from
 * other columns rather than carried through a merge, and ClickHouse accepts
 * them (verified against 26.8).
 */

const MIGRATIONS_DIR = resolve(
  process.cwd(),
  "src/server/clickhouse/migrations",
);

const CONVERGE_MIGRATION = "00088_aggregating_rollup_dimension_columns.sql";

/** Column names that never carry a merge rule of their own. */
const NON_COLUMN_PREFIXES = ["INDEX", "CONSTRAINT", "PROJECTION", "PRIMARY"];

/**
 * The columns that were declared without a merge rule before 00087, and the
 * merged migrations that still create them that way.
 *
 * These files have run somewhere, so they cannot change: `migration-order`
 * fails a branch that edits a migration already on main. A new install still
 * replays them, so on a server that enforces the check goose.ts runs them with
 * `allow_dimensions_outside_sorting_key` relaxed and 00087 converts the tables
 * immediately after. Every install therefore ends on the same schema.
 *
 * DO NOT add entries. A new migration runs without the compatibility setting,
 * so a column added without a merge rule fails on ClickHouse 26 at deploy time
 * and fails here on every version.
 */
const HISTORICAL_DIMENSIONS: {
  file: string;
  table: string;
  column: string;
}[] = [
  {
    file: "00017_create_gateway_budget_ledger.sql",
    table: "gateway_budget_scope_totals",
    column: "UpdatedAt",
  },
  {
    file: "00038_create_trace_analytics_rollup.sql",
    table: "trace_analytics_rollup",
    column: "_retention_days",
  },
  {
    file: "00040_create_evaluation_analytics_rollup.sql",
    table: "evaluation_analytics_rollup",
    column: "_retention_days",
  },
  {
    file: "00058_gateway_budget_scope_totals_utc.sql",
    table: "gateway_budget_scope_totals_rebuild",
    column: "UpdatedAt",
  },
  {
    file: "00064_replicate_gateway_budget_scope_totals.sql",
    table: "gateway_budget_scope_totals_rebuild",
    column: "UpdatedAt",
  },
  {
    file: "00065_replicate_trace_analytics_rollup.sql",
    table: "trace_analytics_rollup_rebuild",
    column: "_retention_days",
  },
  {
    file: "00066_replicate_evaluation_analytics_rollup.sql",
    table: "evaluation_analytics_rollup_rebuild",
    column: "_retention_days",
  },
  {
    file: "00069_gateway_budget_scope_totals_budget_grain.sql",
    table: "gateway_budget_scope_totals_rebuild",
    column: "UpdatedAt",
  },
  {
    file: "00081_create_simulation_run_metrics_rollup.sql",
    table: "simulation_run_metrics_rollup",
    column: "PartitionMonth",
  },
];

/** The live tables 00087 converts, and the column each one converts. */
const CONVERGED_COLUMNS = [
  { table: "gateway_budget_scope_totals", column: "UpdatedAt" },
  { table: "trace_analytics_rollup", column: "_retention_days" },
  { table: "evaluation_analytics_rollup", column: "_retention_days" },
  { table: "simulation_run_metrics_rollup", column: "PartitionMonth" },
];

interface Column {
  name: string;
  type: string;
  computed: boolean;
}

interface AggregatingTable {
  file: string;
  table: string;
  columns: Column[];
  sortingKey: string[];
}

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

/** Split on `separator` at paren depth zero, so nested types stay intact. */
function splitTopLevel({
  text,
  separator,
}: {
  text: string;
  separator: string;
}): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** The text between the parentheses that follow `CREATE TABLE <name>`. */
function readColumnList({
  statement,
  openIndex,
}: {
  statement: string;
  openIndex: number;
}): string {
  let depth = 0;
  for (let i = openIndex; i < statement.length; i++) {
    if (statement[i] === "(") depth++;
    if (statement[i] === ")") {
      depth--;
      if (depth === 0) return statement.slice(openIndex + 1, i);
    }
  }
  throw new Error("unbalanced parentheses in CREATE TABLE column list");
}

function parseColumns(columnList: string): Column[] {
  const columns: Column[] = [];
  for (const raw of splitTopLevel({ text: columnList, separator: "," })) {
    const definition = raw.trim().replace(/\s+/g, " ");
    if (definition === "") continue;
    if (
      NON_COLUMN_PREFIXES.some((prefix) =>
        definition.toUpperCase().startsWith(`${prefix} `),
      )
    ) {
      continue;
    }
    const named = definition.match(/^`?([A-Za-z_][A-Za-z0-9_]*)`?\s+(.+)$/);
    if (!named) continue;
    const rest = named[2]!;
    columns.push({
      name: named[1]!,
      type: rest,
      computed: /\b(MATERIALIZED|ALIAS)\b/i.test(rest),
    });
  }
  return columns;
}

/** The column names named by ORDER BY, whether or not it is written as a tuple. */
function parseSortingKey(statement: string): string[] {
  const orderBy = statement.match(
    /ORDER\s+BY\s+([\s\S]+?)(?:\n\s*(?:PARTITION\s+BY|PRIMARY\s+KEY|SAMPLE\s+BY|TTL|SETTINGS|AS)\b|$)/i,
  );
  if (!orderBy) return [];
  return [...orderBy[1]!.matchAll(/`?([A-Za-z_][A-Za-z0-9_]*)`?/g)].map(
    (match) => match[1]!,
  );
}

function collectAggregatingTables(): AggregatingTable[] {
  const tables: AggregatingTable[] = [];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`no migration files found in ${MIGRATIONS_DIR}`);
  }

  for (const file of files) {
    const sql = stripLineComments(
      readFileSync(resolve(MIGRATIONS_DIR, file), "utf8"),
    );
    for (const statement of sql.split(";")) {
      if (!/AggregatingMergeTree/i.test(statement)) continue;
      const create = statement.match(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s*\(/i,
      );
      if (!create) continue;
      const openIndex = statement.indexOf(
        "(",
        create.index! + create[0].length - 1,
      );
      tables.push({
        file,
        table: create[1]!.replace("${CLICKHOUSE_DATABASE}.", ""),
        columns: parseColumns(readColumnList({ statement, openIndex })),
        sortingKey: parseSortingKey(statement),
      });
    }
  }
  return tables;
}

function isAggregateState(type: string): boolean {
  return /^(Simple)?AggregateFunction\s*\(/i.test(type);
}

/** `UInt16 DEFAULT 308 CODEC(...)` reads back as `UInt16`. */
function underlyingType(type: string): string {
  return type
    .split(/\s+(?:DEFAULT|CODEC|MATERIALIZED|ALIAS|TTL)\b/i)[0]!
    .trim();
}

/**
 * The `T` in the `MODIFY COLUMN <column> SimpleAggregateFunction(max, T)` the
 * converge migration issues for this table, or undefined when it issues none.
 * `T` is read by paren depth so a nested type such as DateTime64(3) survives.
 */
function convertedType({
  sql,
  table,
  column,
}: {
  sql: string;
  table: string;
  column: string;
}): string | undefined {
  const alter = new RegExp(
    `ALTER TABLE \\$\\{CLICKHOUSE_DATABASE\\}\\.${table}\\s+MODIFY COLUMN \`?${column}\`?\\s+SimpleAggregateFunction\\(`,
    "i",
  ).exec(sql);
  if (!alter) return undefined;

  const argsStart = alter.index + alter[0].length;
  let depth = 1;
  let end = argsStart;
  while (end < sql.length && depth > 0) {
    if (sql[end] === "(") depth++;
    if (sql[end] === ")") depth--;
    if (depth > 0) end++;
  }
  const args = splitTopLevel({
    text: sql.slice(argsStart, end),
    separator: ",",
  });
  if (args.length !== 2 || args[0]!.trim().toLowerCase() !== "max") {
    return undefined;
  }
  return args[1]!.replace(/\s+/g, " ").trim();
}

function isHistorical({
  file,
  table,
  column,
}: {
  file: string;
  table: string;
  column: string;
}): boolean {
  return HISTORICAL_DIMENSIONS.some(
    (entry) =>
      entry.file === file && entry.table === table && entry.column === column,
  );
}

describe("given the ClickHouse migrations that create AggregatingMergeTree tables", () => {
  const tables = collectAggregatingTables();

  describe("when the create statements are parsed", () => {
    it("finds the rollup tables the migrations create", () => {
      // A parser that silently matched nothing would make every assertion below
      // vacuous, so the set it finds is pinned to the tables that exist.
      expect(new Set(tables.map((t) => t.table))).toEqual(
        new Set([
          "gateway_budget_scope_totals",
          "gateway_budget_scope_totals_rebuild",
          "trace_analytics_rollup",
          "trace_analytics_rollup_rebuild",
          "evaluation_analytics_rollup",
          "evaluation_analytics_rollup_rebuild",
          "simulation_run_metrics_rollup",
        ]),
      );
      for (const table of tables) {
        expect(
          table.columns.length,
          `${table.file}: ${table.table}`,
        ).toBeGreaterThan(0);
        expect(
          table.sortingKey.length,
          `${table.file}: ${table.table}`,
        ).toBeGreaterThan(0);
      }
    });
  });

  describe("when a column is neither in the sorting key nor an aggregate state", () => {
    /** @scenario no new migration creates a rollup column without a merge rule */
    it("fails unless it is one of the merged statements that cannot change", () => {
      const violations = tables.flatMap((table) =>
        table.columns
          .filter(
            (column) =>
              !column.computed &&
              !isAggregateState(column.type) &&
              !table.sortingKey.includes(column.name) &&
              !isHistorical({
                file: table.file,
                table: table.table,
                column: column.name,
              }),
          )
          .map((column) => ({
            file: table.file,
            table: table.table,
            column: column.name,
          })),
      );

      const report = violations
        .map(
          (v) =>
            `${v.file}: ${v.table}.${v.column} is neither in the sorting key nor an\n` +
            `  aggregate state. A merge collapses the rows sharing a sorting key and the\n` +
            `  survivor keeps an arbitrary value of this column, and ClickHouse 26 and\n` +
            `  newer reject the CREATE TABLE outright, which stops the deploy.\n` +
            `  Declare it SimpleAggregateFunction(max, <type>), or add it to ORDER BY.\n` +
            `  The compatibility setting goose.ts applies covers merged history only.`,
        )
        .join("\n\n");

      expect(violations, `\n${report}\n`).toEqual([]);
    });

    /** @scenario the list of merged statements that carry one stays exact */
    it("keeps the historical list pointing at real declarations", () => {
      // An exemption that no longer matches anything would let a real one hide
      // behind it later, so each entry must still name a live declaration.
      for (const entry of HISTORICAL_DIMENSIONS) {
        const table = tables.find(
          (t) => t.file === entry.file && t.table === entry.table,
        );
        expect(
          table,
          `${entry.file} no longer creates ${entry.table}; remove the stale entry`,
        ).toBeDefined();
        const column = table!.columns.find((c) => c.name === entry.column);
        expect(
          column,
          `${entry.file}: ${entry.table} no longer declares ${entry.column}; remove the stale entry`,
        ).toBeDefined();
        expect(
          isAggregateState(column!.type),
          `${entry.file}: ${entry.table}.${entry.column} now declares an aggregate state; remove the stale entry`,
        ).toBe(false);
      }
    });
  });

  describe("when the converge migration is read", () => {
    const upSection = stripLineComments(
      readFileSync(resolve(MIGRATIONS_DIR, CONVERGE_MIGRATION), "utf8").split(
        "-- +goose Down",
      )[0]!,
    );

    /** @scenario an install created before the rule converges on the same schema */
    it("modifies every historical column to merge by max on its own type", () => {
      for (const { table, column } of CONVERGED_COLUMNS) {
        const declared = tables
          .filter((t) => t.table === table)
          .flatMap((t) => t.columns)
          .find((c) => c.name === column);
        expect(
          declared,
          `${table}.${column} is not created by any migration`,
        ).toBeDefined();

        const converted = convertedType({ sql: upSection, table, column });
        expect(
          converted,
          `${CONVERGE_MIGRATION} does not convert ${table}.${column}; an install created before the rule keeps the plain column`,
        ).not.toBeUndefined();
        expect(
          converted,
          `${CONVERGE_MIGRATION} converts ${table}.${column} to a different type than the create statements declare`,
        ).toBe(underlyingType(declared!.type));
      }
    });
  });

  describe("when the runner decides which migrations to relax the check for", () => {
    /** @scenario the compatibility setting covers merged history only */
    it("relaxes it up to the migration before the converge migration", () => {
      const goose = readFileSync(
        resolve(process.cwd(), "src/server/clickhouse/goose.ts"),
        "utf8",
      );
      const declared = goose.match(
        /const LAST_MIGRATION_NEEDING_DIMENSION_COMPAT = (\d+);/,
      );
      expect(
        declared,
        "goose.ts no longer declares LAST_MIGRATION_NEEDING_DIMENSION_COMPAT",
      ).not.toBeNull();
      const boundary = Number(declared![1]);

      const converge = Number(CONVERGE_MIGRATION.slice(0, 5));
      const highestHistorical = Math.max(
        ...HISTORICAL_DIMENSIONS.map((entry) => Number(entry.file.slice(0, 5))),
      );

      // Below the highest historical file the compatibility phase would stop
      // short and a new install would fail on the first one it missed; at or
      // above the converge migration a later migration would inherit the
      // relaxed check and could add a column without a merge rule unnoticed.
      expect(boundary).toBeGreaterThanOrEqual(highestHistorical);
      expect(boundary).toBeLessThan(converge);
    });
  });
});

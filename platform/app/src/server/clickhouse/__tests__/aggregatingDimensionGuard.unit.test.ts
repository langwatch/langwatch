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

/** Column names that never carry a merge rule of their own. */
const NON_COLUMN_PREFIXES = ["INDEX", "CONSTRAINT", "PROJECTION", "PRIMARY"];

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
function splitTopLevel(text: string, separator: string): string[] {
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
function readColumnList(statement: string, openIndex: number): string {
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
  for (const raw of splitTopLevel(columnList, ",")) {
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
        columns: parseColumns(readColumnList(statement, openIndex)),
        sortingKey: parseSortingKey(statement),
      });
    }
  }
  return tables;
}

function isAggregateState(type: string): boolean {
  return /^(Simple)?AggregateFunction\s*\(/i.test(type);
}

describe("ClickHouse AggregatingMergeTree dimension guard", () => {
  const tables = collectAggregatingTables();

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

  /** @scenario no migration creates a rollup column without a merge rule */
  it("every column is in the sorting key or is an aggregate state", () => {
    const violations = tables.flatMap((table) =>
      table.columns
        .filter(
          (column) =>
            !column.computed &&
            !isAggregateState(column.type) &&
            !table.sortingKey.includes(column.name),
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
          `  newer reject the CREATE TABLE outright, which stops a fresh install.\n` +
          `  Declare it SimpleAggregateFunction(max, <type>), or add it to ORDER BY.`,
      )
      .join("\n\n");

    expect(violations, `\n${report}\n`).toEqual([]);
  });

  /** @scenario an install created before the rule converges on the same schema */
  it("the converge migration sets the same types the create statements declare", () => {
    // An install created on an older ClickHouse still has the plain columns;
    // 00087 modifies them. If a create statement's type and the ALTER drift
    // apart, installs of different ages end up with different schemas.
    const converge = readFileSync(
      resolve(MIGRATIONS_DIR, "00087_aggregating_rollup_dimension_columns.sql"),
      "utf8",
    );
    const upSection = stripLineComments(converge.split("-- +goose Down")[0]!);

    const converged = [
      { table: "gateway_budget_scope_totals", column: "UpdatedAt" },
      { table: "trace_analytics_rollup", column: "_retention_days" },
      { table: "evaluation_analytics_rollup", column: "_retention_days" },
      { table: "simulation_run_metrics_rollup", column: "PartitionMonth" },
    ];

    for (const { table, column } of converged) {
      const declared = tables
        .filter((t) => t.table === table)
        .flatMap((t) => t.columns)
        .find((c) => c.name === column);
      expect(
        declared,
        `${table}.${column} is not created by any migration`,
      ).toBeDefined();
      const declaredType = declared!.type.match(
        /^(Simple)?AggregateFunction\s*\([^)]*\)/i,
      )?.[0];
      expect(
        declaredType,
        `${table}.${column} does not declare an aggregate state`,
      ).toBeDefined();

      const altered = upSection.match(
        new RegExp(
          `ALTER TABLE \\$\\{CLICKHOUSE_DATABASE\\}\\.${table}\\s+MODIFY COLUMN \`?${column}\`?\\s+((Simple)?AggregateFunction\\s*\\([^)]*\\))`,
          "i",
        ),
      );
      expect(
        altered,
        `00087 does not modify ${table}.${column}; an install created before the rule keeps the plain column`,
      ).not.toBeNull();
      expect(
        altered![1]!.replace(/\s+/g, " "),
        `00087 sets a different type for ${table}.${column} than the create statements declare`,
      ).toBe(declaredType!.replace(/\s+/g, " "));
    }
  });
});

/**
 * Reads the shape of every ClickHouse table out of the goose migrations.
 *
 * This exists so {@link ./schema-catalogue.ts} can be COMPARED to the DDL
 * rather than merely believed. Three hand-kept descriptions of "which column
 * does this table partition on" had drifted apart before this was written —
 * the runtime cold-scan detector knew 11 of the 33 partitioned tables, a facet
 * registry knew 3, and the written guidance named the wrong column for
 * `evaluation_runs` — and none of them ever went red, because nothing compared
 * them to the migrations.
 *
 * It is a text reader, not a SQL parser, and it only understands the small
 * dialect our migrations are actually written in: one `CREATE TABLE` per
 * `-- +goose StatementBegin` block, `PARTITION BY` / `ORDER BY` / `TTL` on
 * their own lines after the closing paren, `DROP TABLE`, `EXCHANGE TABLES`,
 * and the `ALTER TABLE` forms our migrations use — `MODIFY ORDER BY`,
 * `MODIFY TTL`, and `ADD`/`MODIFY`/`RENAME`/`DROP COLUMN`. That is enough to
 * be exact about the facts a declaration claims, and anything it cannot read
 * it reports rather than skipping — a reader that silently understands less
 * over time is the exact failure this file was written to end.
 *
 * Commented lines are inert, and everything after `-- +goose Down` is ignored:
 * a Down block is not what the database is running. Migrations are applied in
 * file-name order, so later statements overwrite earlier ones and the result is
 * the schema as it stands.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The migration directory, resolved relative to this file rather than cwd. */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL("./migrations", import.meta.url),
);

/** One table's storage shape, exactly as the migrations leave it. */
export interface MigrationTableShape {
  /** Unqualified table name. */
  readonly table: string;
  /**
   * The `PARTITION BY` expression verbatim, whitespace-normalised.
   *
   * Verbatim rather than "the column it wraps": `toYearWeek(toDate(BucketStart))`
   * and `toYearWeek(BucketStart)` prune differently at the edges, and a reader
   * that reduced both to `BucketStart` would call two different tables the same.
   * The catalogue declares the expression and the column separately, and the
   * drift check requires the column to appear inside the expression.
   */
  readonly partitionExpression: string | null;
  /** The `ORDER BY` tuple, in order, as the engine's sort key stands today. */
  readonly sortKey: readonly string[];
  /**
   * The `ReplacingMergeTree(<col>)` version column, or null for engines that
   * have none (AggregatingMergeTree, plain MergeTree).
   */
  readonly versionColumn: string | null;
  /**
   * Declared type per column, in physical order, after every `ALTER`.
   *
   * Types matter because a declaration naming the wrong one decodes wrong or
   * throws rather than failing loudly at the boundary — `Nullable(UInt32)` read
   * as a `UInt64` expects a quoted string and gets a bare number. The `ALTER`
   * fold matters because most columns on the oldest tables arrived that way,
   * and a reader that only saw `CREATE TABLE` bodies reported them as absent.
   */
  readonly columnTypes: ReadonlyMap<string, string>;
  /**
   * The `TTL` clause verbatim, whitespace-normalised, or null when the DDL has
   * none. Null does not mean "never expires": `ttlReconciler.ts` sets the TTL
   * on the retention-managed tables at runtime, and their DDL carries none.
   */
  readonly ttlExpression: string | null;
  /** The migration file that last defined this table's shape. */
  readonly definedIn: string;
}

const GOOSE_DOWN = /^--\s*\+goose\s+Down\b/;
const GOOSE_UP = /^--\s*\+goose\s+Up\b/;

/**
 * Drops a trailing `--` comment, leaving quoted text alone.
 *
 * Not cosmetic. `ResultType LowCardinality(String),  -- 'target' or 'evaluator'`
 * ends a column declaration with a comment, so a reader that only skipped
 * WHOLE comment lines left the comment attached to the FOLLOWING column — and
 * `DatasetEntry`, the column after it, silently vanished from the schema. The
 * quote-awareness is what keeps a `DEFAULT '--'` from truncating a line.
 */
function stripTrailingComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length - 1; index++) {
    if (line[index] === "'") quoted = !quoted;
    if (!quoted && line[index] === "-" && line[index + 1] === "-") {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}

/**
 * The `Up` half of a migration with comments and blank lines removed.
 *
 * A Down block is not running anywhere, so a `DROP TABLE` sitting in one must
 * not be read as the table being gone — most of our Down blocks are exactly
 * that, commented out, and reading them would empty the catalogue.
 */
function liveUpStatements(body: string): string {
  const kept: string[] = [];
  let inDown = false;

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (GOOSE_DOWN.test(trimmed)) {
      inDown = true;
      continue;
    }
    if (GOOSE_UP.test(trimmed)) {
      inDown = false;
      continue;
    }
    if (inDown || trimmed === "" || trimmed.startsWith("--")) continue;
    const live = stripTrailingComment(trimmed);
    if (live !== "") kept.push(live);
  }

  return kept.join("\n");
}

/**
 * Strips the database qualifier so `${CLICKHOUSE_DATABASE}.stored_spans`,
 * `langwatch.stored_spans` and a bare `stored_objects` all name one table.
 * The migrations use all three spellings (00023 deliberately omits the
 * qualifier), and they are the same table to the running database.
 */
function unqualify(name: string): string {
  return name.replace(/^\$\{[^}]*\}\./, "").replace(/^[\w$]+\./, "");
}

/** Splits a top-level tuple, respecting nested parens: `a, f(b, c)` -> 2 parts. */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of inner) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() !== "") parts.push(current.trim());

  return parts;
}

/**
 * The `ORDER BY` tuple as a list of key expressions.
 *
 * A single-column sort key is written without parens (`ORDER BY (project_id, id)`
 * has them, `ORDER BY id` would not), so both spellings are read.
 */
function parseSortKey(clause: string): string[] {
  const trimmed = clause.trim().replace(/;$/, "").trim();
  if (trimmed.startsWith("(")) {
    return splitTopLevel(trimmed.slice(1, trimmed.lastIndexOf(")")));
  }
  return [trimmed];
}

/**
 * The version column out of an engine clause.
 *
 * Our migrations write the engine through an envsub default so one file works
 * both with and without a cluster:
 *   `ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)`
 * The `(` lives inside the default and the `}` closes the substitution, so the
 * column sits between `}` and `)`. The plain `ReplacingMergeTree(UpdatedAt)`
 * spelling is read too.
 */
function parseVersionColumn(engine: string): string | null {
  const envsub = /ReplacingMergeTree\(\}\s*([\w$]+)\s*\)/i.exec(engine);
  if (envsub?.[1]) return envsub[1];

  const plain = /ReplacingMergeTree\(\s*([\w$]+)\s*\)/i.exec(engine);
  if (plain?.[1]) return plain[1];

  return null;
}

/**
 * The column name out of one declaration.
 *
 * A backtick-quoted name may contain dots (`` `Events.Timestamp` ``), and it
 * must keep them: stopping at the dot collapsed `stored_spans`' three
 * `Events.*` columns onto one name called `Events`.
 */
function parseColumnName(declaration: string): string | null {
  return /^`?([\w$.]+)`?/.exec(declaration.trim())?.[1] ?? null;
}

/** Everything after the type is storage or derivation detail, not the type. */
const COLUMN_TAIL =
  /^(?:CODEC|DEFAULT|MATERIALIZED|ALIAS|EPHEMERAL|TTL|COMMENT|SETTINGS|AFTER|FIRST)\b/i;

/**
 * The type expression out of one declaration, or null when it carries none.
 *
 * A type nests (`Map(LowCardinality(String), UInt32)`,
 * `Array(Tuple(String, UInt32, Bool))`), so the cut is the first depth-zero
 * space followed by a tail keyword rather than the first space.
 */
function parseColumnType(declaration: string): string | null {
  const rest = /^`?[\w$.]+`?\s+([\s\S]+)$/.exec(declaration.trim())?.[1];
  if (rest === undefined || COLUMN_TAIL.test(rest)) return null;

  let depth = 0;
  let end = rest.length;
  for (let index = 0; index < rest.length; index++) {
    const char = rest[index]!;
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (
      depth === 0 &&
      /\s/.test(char) &&
      COLUMN_TAIL.test(rest.slice(index + 1))
    ) {
      end = index;
      break;
    }
  }
  return rest.slice(0, end).trim().replace(/\s+/g, " ").replace(/,\s*/g, ", ");
}

/**
 * Columns and their types out of a CREATE TABLE body, in declaration order.
 * Index and constraint declarations are skipped.
 */
function parseColumns(body: string): Map<string, string> {
  const columns = new Map<string, string>();

  for (const part of splitTopLevel(body)) {
    const declaration = part.trim();
    if (/^(?:INDEX|CONSTRAINT|PRIMARY\s+KEY|PROJECTION)\b/i.test(declaration)) {
      continue;
    }
    const name = parseColumnName(declaration);
    if (name) columns.set(name, parseColumnType(declaration) ?? "");
  }

  return columns;
}

/** The four `ALTER` actions that change a table's column set. */
const COLUMN_ACTION = /^(?:ADD|MODIFY|RENAME|DROP)\s+COLUMN\b/i;

/** Applies one {@link COLUMN_ACTION} to a table's accumulated columns. */
function applyColumnAction(action: string, columns: Map<string, string>): void {
  const added = /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i.exec(
    action,
  );
  if (added) {
    const name = parseColumnName(added[1]!);
    if (name) columns.set(name, parseColumnType(added[1]!) ?? "");
    return;
  }

  const modified = /^MODIFY\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([\s\S]+)$/i.exec(
    action,
  );
  if (modified) {
    const name = parseColumnName(modified[1]!);
    if (name && columns.has(name)) {
      columns.set(name, parseColumnType(modified[1]!) ?? "");
    }
    return;
  }

  const renamed =
    /^RENAME\s+COLUMN\s+(?:IF\s+EXISTS\s+)?`?([\w$.]+)`?\s+TO\s+`?([\w$.]+)`?/i.exec(
      action,
    );
  if (renamed) {
    const type = columns.get(renamed[1]!);
    if (type !== undefined) {
      columns.delete(renamed[1]!);
      columns.set(renamed[2]!, type);
    }
    return;
  }

  const dropped = /^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?`?([\w$.]+)`?/i.exec(
    action,
  );
  if (dropped) columns.delete(dropped[1]!);
}

const CREATE_TABLE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(/gi;

/** The index just past the paren closing a `CREATE TABLE`'s column list. The
 *  body nests (types, codecs, index expressions), so depth is the only guide. */
function endOfColumnList(sql: string, from: number): number {
  let depth = 1;
  let cursor = from;
  while (cursor < sql.length && depth > 0) {
    if (sql[cursor] === "(") depth++;
    if (sql[cursor] === ")") depth--;
    cursor++;
  }
  return cursor;
}

/**
 * Everything from a `CREATE TABLE`'s closing paren to its `;` — the clause the
 * engine, partition key, sort key and TTL live in.
 */
function parseTableTail(
  tail: string,
): Omit<MigrationTableShape, "table" | "columnTypes" | "definedIn"> {
  const partition = /PARTITION\s+BY\s+([^\n]+)/i.exec(tail)?.[1]?.trim();
  // The clause runs to the next top-level keyword. `PARTITION BY` is one of
  // them because 00036 writes `ORDER BY` first — a lookahead that omitted it
  // swallowed the partition clause into the sort key and reported a sort key
  // no engine has.
  const order =
    /ORDER\s+BY\s+([\s\S]*?)(?=\n\s*(?:TTL|SETTINGS|PRIMARY\s+KEY|SAMPLE\s+BY|PARTITION\s+BY|ENGINE)\b|$)/i.exec(
      tail,
    )?.[1];
  const engine = /ENGINE\s*=\s*([^\n]+)/i.exec(tail)?.[1] ?? "";
  // Our TTL clauses wrap the anchor in `IF(_retention_days > 0, …)` and span
  // several lines, so this runs to `SETTINGS` rather than to a newline.
  const ttl = /\bTTL\s+([\s\S]*?)(?=\s+SETTINGS\b|$)/i.exec(tail)?.[1]?.trim();

  return {
    partitionExpression: partition ? partition.replace(/\s+/g, " ") : null,
    sortKey: order ? parseSortKey(order) : [],
    versionColumn: parseVersionColumn(engine),
    ttlExpression: ttl ? ttl.replace(/\s+/g, " ") : null,
  };
}

/** Every `CREATE TABLE` in one migration, replacing whatever shape it had. */
function applyCreateTables(
  sql: string,
  entry: string,
  shapes: Map<string, MigrationTableShape>,
): void {
  CREATE_TABLE.lastIndex = 0;
  let created: RegExpExecArray | null = CREATE_TABLE.exec(sql);
  while (created !== null) {
    const table = unqualify(created[1]!);
    const bodyStart = created.index + created[0].length;
    const cursor = endOfColumnList(sql, bodyStart);
    const tailEnd = sql.indexOf(";", cursor);

    // A MATERIALIZED VIEW's target table is the one that stores rows; the view
    // itself has no partition key of its own to catalogue.
    shapes.set(table, {
      table,
      ...parseTableTail(
        sql.slice(cursor, tailEnd === -1 ? sql.length : tailEnd),
      ),
      columnTypes: parseColumns(sql.slice(bodyStart, cursor - 1)),
      definedIn: entry,
    });

    CREATE_TABLE.lastIndex = tailEnd === -1 ? sql.length : tailEnd;
    created = CREATE_TABLE.exec(sql);
  }
}

/**
 * Reads one migration file's effect onto the accumulating schema.
 *
 * Mutates `shapes` in place because migrations are cumulative by nature: a
 * later file's `ALTER … MODIFY ORDER BY` changes a table an earlier file
 * created, and modelling that as anything other than an ordered fold over the
 * directory would misread it.
 */
function applyMigration({
  entry,
  sql,
  shapes,
}: {
  entry: string;
  sql: string;
  shapes: Map<string, MigrationTableShape>;
}): void {
  applyCreateTables(sql, entry, shapes);

  // DROP, EXCHANGE and MODIFY ORDER BY are applied in the order they appear in
  // the file, not grouped by kind. 00058 creates a scratch rollup, EXCHANGEs it
  // with the live one and THEN drops the scratch; running every DROP before
  // every EXCHANGE reverses that and resurrects a table the migration deleted.
  const rewrites: { at: number; apply: () => void }[] = [];

  for (const dropped of sql.matchAll(
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)/gi,
  )) {
    const table = unqualify(dropped[1]!);
    rewrites.push({ at: dropped.index, apply: () => shapes.delete(table) });
  }

  // `EXCHANGE TABLES a AND b` swaps two tables atomically — 00058 rebuilds a
  // rollup under a scratch name and swaps it in. Without this the catalogue
  // would describe the pre-rebuild shape of a table that no longer has it.
  for (const swap of sql.matchAll(
    /EXCHANGE\s+TABLES\s+([^\s;]+)\s+AND\s+([^\s;]+)/gi,
  )) {
    const left = unqualify(swap[1]!);
    const right = unqualify(swap[2]!);
    rewrites.push({
      at: swap.index,
      apply: () => {
        const leftShape = shapes.get(left);
        const rightShape = shapes.get(right);
        if (leftShape) shapes.set(right, { ...leftShape, table: right });
        if (rightShape) shapes.set(left, { ...rightShape, table: left });
      },
    });
  }

  // `MODIFY ORDER BY` need not be the ALTER's only action: 00063 extends
  // governance_kpis with `ADD COLUMN EventId …, MODIFY ORDER BY (…)` in one
  // statement, because ClickHouse only permits the sorting key to be extended
  // by a column added in the same ALTER. A pattern that expected MODIFY
  // directly after the table name read straight past it and reported the
  // original four-column key.
  for (const altered of sql.matchAll(/ALTER\s+TABLE\s+(\S+)([^;]*);/gi)) {
    const table = unqualify(altered[1]!);
    const at = altered.index;

    const modify = /MODIFY\s+ORDER\s+BY\s+([\s\S]*)$/i.exec(altered[2]!);
    if (modify) {
      const sortKey = parseSortKey(modify[1]!);
      rewrites.push({
        at,
        apply: () => {
          const existing = shapes.get(table);
          if (existing) shapes.set(table, { ...existing, sortKey });
        },
      });
    }

    // The actions are split at depth-zero commas, because a column type carries
    // commas of its own: splitting on every comma truncates
    // `Array(Tuple(String, UInt32, Bool))` to `Array(Tuple(String`.
    for (const action of splitTopLevel(altered[2]!).map((part) =>
      part.trim(),
    )) {
      if (COLUMN_ACTION.test(action)) {
        rewrites.push({
          at,
          apply: () => {
            const existing = shapes.get(table);
            if (!existing) return;
            const columnTypes = new Map(existing.columnTypes);
            applyColumnAction(action, columnTypes);
            shapes.set(table, { ...existing, columnTypes });
          },
        });
        continue;
      }

      const ttl = /^MODIFY\s+TTL\s+([\s\S]+)$/i.exec(action);
      if (!ttl) continue;
      const ttlExpression = ttl[1]!.trim().replace(/\s+/g, " ");
      rewrites.push({
        at,
        apply: () => {
          const existing = shapes.get(table);
          if (existing) shapes.set(table, { ...existing, ttlExpression });
        },
      });
    }
  }

  rewrites.sort((left, right) => left.at - right.at);
  for (const rewrite of rewrites) rewrite.apply();
}

/**
 * Every table the migrations leave in place, keyed by unqualified name.
 *
 * Tables a later migration dropped are absent, which is the point: a catalogue
 * entry for a dropped table is drift too.
 */
export function readMigrationSchema(
  directory: string = MIGRATIONS_DIR,
): Map<string, MigrationTableShape> {
  const entries = readdirSync(directory)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();

  const shapes = new Map<string, MigrationTableShape>();
  for (const entry of entries) {
    const sql = liveUpStatements(readFileSync(join(directory, entry), "utf8"));
    applyMigration({ entry, sql, shapes });
  }

  return shapes;
}

/** How many `.sql` files the migration directory holds. */
export function countMigrationFiles(
  directory: string = MIGRATIONS_DIR,
): number {
  return readdirSync(directory).filter((entry) => entry.endsWith(".sql"))
    .length;
}

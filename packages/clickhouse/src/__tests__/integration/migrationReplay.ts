/**
 * Extracts, verbatim, the `CREATE`/`ALTER`/`DROP TABLE` statements the
 * deployed goose migrations run against one table — never a hand-transcribed
 * copy of them. This is a text reader, not a SQL parser: it only understands
 * goose's own block markers (`-- +goose Up`/`Down`, `StatementBegin`/
 * `StatementEnd`) and does not interpret column types, engines or
 * expressions. The extracted text is handed to ClickHouse verbatim, which is
 * the one thing that actually parses the DDL — both here and in a real
 * deploy — so this module can never encode a wrong belief about what a
 * `CREATE TABLE` means.
 *
 * Mirrors `langwatch/src/server/clickhouse/migrationDdl.ts`'s Up/Down state
 * machine rather than importing it: this package carries no dependency on
 * application code (see `vitest.config.ts`'s docblock), and that module's job
 * — deriving structured facts for the schema catalogue — is different from
 * this one's, which only needs the raw statement text.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const GOOSE_UP = /^--\s*\+goose\s+Up\b/;
const GOOSE_DOWN = /^--\s*\+goose\s+Down\b/;
const STATEMENT_BEGIN = /^--\s*\+goose\s+StatementBegin\b/;
const STATEMENT_END = /^--\s*\+goose\s+StatementEnd\b/;

/**
 * Every `StatementBegin`/`StatementEnd` block in the file's `Up` section, in
 * file order. A block inside `Down` never appears — a Down migration is not
 * what the database is running, and every Down block in this migration
 * directory is commented out for exactly that reason.
 */
function statementBlocks(sql: string): string[] {
  const blocks: string[] = [];
  let inDown = false;
  let inStatement = false;
  let current: string[] = [];

  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (GOOSE_DOWN.test(trimmed)) {
      inDown = true;
      continue;
    }
    if (GOOSE_UP.test(trimmed)) {
      inDown = false;
      continue;
    }
    if (inDown) continue;
    if (STATEMENT_BEGIN.test(trimmed)) {
      inStatement = true;
      current = [];
      continue;
    }
    if (STATEMENT_END.test(trimmed)) {
      inStatement = false;
      const text = current.join("\n").trim();
      if (text) blocks.push(text);
      continue;
    }
    if (inStatement) current.push(line);
  }

  return blocks;
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a statement's opening clause names `table` — `CREATE TABLE [IF NOT
 * EXISTS]`, `ALTER TABLE`, or `DROP TABLE [IF EXISTS]`, optionally qualified
 * with `${CLICKHOUSE_DATABASE}.` (migration 00023 deliberately omits the
 * qualifier; every other migration in this directory includes it). A mention
 * of the table name elsewhere in the block — a comment, a column reference —
 * does not match, because the table name must immediately follow the
 * keyword.
 */
function targetsTable(statement: string, table: string): boolean {
  const pattern = new RegExp(
    String.raw`\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+(?:\$\{CLICKHOUSE_DATABASE\}\.)?${escapeRegExp(table)}\b`,
    "i",
  );
  return pattern.test(statement);
}

/**
 * Resolves goose's `ENVSUB` placeholders to the values this package's test
 * ClickHouse always runs under: no cluster, no `local_primary` storage
 * policy. Mirrors `buildMigrationEnvVars`'s non-clustered case in
 * `langwatch/src/server/clickhouse/goose.ts` — read, not imported, for the
 * same reason as the module docblock above.
 */
function substituteLocalDefaults(statement: string): string {
  return statement
    .replace(/\$\{CLICKHOUSE_DATABASE\}\./g, "")
    .replace(
      /\$\{CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree\(\}/g,
      "ReplacingMergeTree(",
    )
    .replace(/\$\{CLICKHOUSE_STORAGE_POLICY_SETTING\}/g, "");
}

/**
 * The pure core: every statement targeting `table`, across `files` in the
 * order given, substituted for local defaults. `files` is filename to
 * content, already in the order migrations must apply — callers reading
 * from disk sort by filename first, the same order goose applies them in.
 */
export function extractTableStatementsFromFiles(
  files: ReadonlyMap<string, string>,
  table: string,
): string[] {
  const statements: string[] = [];
  for (const sql of files.values()) {
    for (const block of statementBlocks(sql)) {
      if (targetsTable(block, table)) {
        statements.push(substituteLocalDefaults(block));
      }
    }
  }
  return statements;
}

/**
 * Every statement the deployed migrations run against `table`, across every
 * `.sql` file in `migrationsDir`, in filename order — the same order goose
 * applies them in. A later migration's `ALTER TABLE` on the same table is
 * included, so replaying the result against a fresh database reproduces the
 * table's shape exactly as it stands today, not merely as its `CREATE TABLE`
 * left it.
 */
export function extractTableStatements(
  migrationsDir: string,
  table: string,
): string[] {
  const filenames = readdirSync(migrationsDir)
    .filter((entry) => entry.endsWith(".sql"))
    .sort();

  const files = new Map<string, string>();
  for (const filename of filenames) {
    files.set(filename, readFileSync(join(migrationsDir, filename), "utf8"));
  }

  return extractTableStatementsFromFiles(files, table);
}

/**
 * The pure text rules behind the ClickHouse migration scanner: no imports, no
 * I/O — the test reads the files and passes the SQL in. Every finding carries
 * its own fix, the way a lint message does. ADR-155.
 */

/** One refusal: what is wrong, and what to write instead. */
export interface MigrationFinding {
  readonly migration: string;
  readonly rule: string;
  readonly problem: string;
  readonly fix: string;
}

/** A migration as the scanner sees it: its sortable name and its whole SQL. */
export interface MigrationSource {
  readonly name: string;
  readonly sql: string;
}

const RETIREMENT_MARKER = /--[ \t]*contract:[ \t]*retired in[ \t]+(\S+)/gi;

const RETIREMENT_FIX =
  "if the code stopped reading and writing it a full release ago, put " +
  "`-- contract: retired in <release>` above the statement, naming the release that stopped " +
  "using it; if it has not, ship that code first — a rollback to the previous image must " +
  "still find its schema. Replacing a view: CREATE OR REPLACE VIEW, or EXCHANGE TABLES for " +
  "a materialized one — never drop then create, because every read in the gap fails.";

/** Comment bodies blanked out, offsets preserved, so statements and markers never mix. */
export function maskComments(sql: string): string {
  let out = "";
  let index = 0;
  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      const newline = sql.indexOf("\n", index);
      const stop = newline === -1 ? sql.length : newline;
      out += " ".repeat(stop - index);
      index = stop;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      const close = sql.indexOf("*/", index + 2);
      const stop = close === -1 ? sql.length : close + 2;
      out += sql.slice(index, stop).replaceAll(/[^\n]/g, " ");
      index = stop;
      continue;
    }
    out += sql[index];
    index += 1;
  }
  return out;
}

function retiredBefore(sql: string, statementOffset: number): boolean {
  return [...sql.matchAll(RETIREMENT_MARKER)].some((match) => match.index < statementOffset);
}

/** Splits the goose up half from the down half; a file without `-- +goose Down` is all up. */
export function gooseHalves(sql: string): { up: string; down: string } {
  const marker = /^[ \t]*--[ \t]*\+goose[ \t]+Down\b/im.exec(sql);
  if (!marker) return { up: sql, down: "" };
  return { up: sql.slice(0, marker.index), down: sql.slice(marker.index) };
}

function statementsIn(liveSql: string): string[] {
  return liveSql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function dropFindings(up: string, liveUp: string): Omit<MigrationFinding, "migration">[] {
  const pattern = /\bDROP\s+(COLUMN|TABLE|VIEW|DICTIONARY)\s+(?:IF\s+EXISTS\s+)?`?([\w.${}]+)`?/gi;
  return [...liveUp.matchAll(pattern)]
    .filter((match) => !retiredBefore(up, match.index))
    .map((match) => ({
      rule: "drop-without-retirement-note",
      problem: `drops ${match[1]!.toLowerCase()} ${match[2]} with no retirement note above it`,
      fix: RETIREMENT_FIX,
    }));
}

function typeChangeFindings(up: string, liveUp: string): Omit<MigrationFinding, "migration">[] {
  const pattern = /\bMODIFY\s+COLUMN\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?\s+(\S+)/gi;
  return [...liveUp.matchAll(pattern)]
    .filter(
      (match) => !/^(TTL|CODEC|REMOVE|COMMENT|SETTINGS|MODIFY)\b/.test(match[2]!.toUpperCase()),
    )
    .filter((match) => !retiredBefore(up, match.index))
    .map((match) => ({
      rule: "modify-column-type",
      problem: `changes the type of column ${match[1]} to ${match[2]}`,
      fix:
        "a type change rewrites every part while the previous image still decodes the old type. " +
        "Add a column with the new type, backfill it, switch the readers, then retire the old one " +
        "under the removal rule. Setting only a CODEC, TTL or comment: write `MODIFY COLUMN " +
        "<name> CODEC(...)` without restating the type, which is then not a type change at all.",
    }));
}

function variableSizeFindings(liveUp: string): Omit<MigrationFinding, "migration">[] {
  const pattern = /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s+([^,;]*)/gi;
  return [...liveUp.matchAll(pattern)]
    .filter((match) => /^\s*(Array|Map|Tuple|Nested)\s*\(/i.test(match[2] ?? ""))
    .filter((match) => !/\bDEFAULT\b/i.test(match[2] ?? ""))
    .map((match) => ({
      rule: "add-variable-size-column-without-default",
      problem: `adds variable-size column ${match[1]} with no DEFAULT`,
      fix:
        "write `DEFAULT []` (or the empty value of the type). A variable-size column added by " +
        "ALTER is unmaterialised in every part written before it, and a read of such a part " +
        "without a default decodes garbage — Code 173 at read time, Code 241 at merge time.",
    }));
}

function blockFindings(up: string): Omit<MigrationFinding, "migration">[] {
  const pattern =
    /--[ \t]*\+goose[ \t]+StatementBegin\b([\s\S]*?)--[ \t]*\+goose[ \t]+StatementEnd\b/gi;
  return [...up.matchAll(pattern)]
    .map((match) => statementsIn(maskComments(match[1] ?? "")).length)
    .filter((count) => count > 1)
    .map((count) => ({
      rule: "one-statement-per-goose-block",
      problem: `holds ${count} statements in one -- +goose StatementBegin block`,
      fix:
        "give each statement its own StatementBegin/StatementEnd pair. ClickHouse has no " +
        "multi-statement query, so the second statement in a block is sent as part of the " +
        "first and the migration fails halfway, leaving the schema in neither shape.",
    }));
}

function downFindings(down: string): Omit<MigrationFinding, "migration">[] {
  if (statementsIn(maskComments(down)).length === 0) return [];
  return [
    {
      rule: "live-down-migration",
      problem: "the -- +goose Down section holds SQL that is not commented out",
      fix:
        "comment the down migration out under the note `To roll back, uncomment and run " +
        "manually.` A ClickHouse down migration is destructive and irreversible, so it is never " +
        "something goose runs on its own; the way back from a bad release is the previous image " +
        "on the migrated schema, which is what the expand/contract rules guarantee.",
    },
  ];
}

/** Every rule the ClickHouse scanner applies to one goose migration file. */
export function scanClickHouseMigration({ name, sql }: MigrationSource): MigrationFinding[] {
  const { up, down } = gooseHalves(sql);
  const liveUp = maskComments(up);
  return [
    ...dropFindings(up, liveUp),
    ...typeChangeFindings(up, liveUp),
    ...variableSizeFindings(liveUp),
    ...blockFindings(up),
    ...downFindings(down),
  ].map((finding) => ({ migration: name, ...finding }));
}

/** The committed baseline file: one migration name per line, `#` comments ignored. */
export function parseBaseline(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/** The findings, as the failing test prints them. */
export function formatFindings(findings: readonly MigrationFinding[]): string {
  return findings
    .map(
      (finding) =>
        `${finding.migration}\n  ${finding.rule}: ${finding.problem}\n    fix: ${finding.fix}`,
    )
    .join("\n\n");
}

/**
 * The pure text rules behind the Postgres migration scanner: no imports, no
 * I/O — the test reads the folders and passes the SQL in. Every finding carries
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
  "still find its schema.";

const RENAME_FIX =
  "never rename in place: add the new name, backfill it, write both (or read both), switch " +
  "the readers, then retire the old name under the removal rule. Each step is its own " +
  "release, and every one of them has a way back.";

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

function dropFindings(sql: string, live: string): Omit<MigrationFinding, "migration">[] {
  const pattern = /\bDROP\s+(COLUMN|TABLE)\s+(?:IF\s+EXISTS\s+)?"?([\w.]+)"?/gi;
  return [...live.matchAll(pattern)]
    .filter((match) => !retiredBefore(sql, match.index))
    .map((match) => ({
      rule: "drop-without-retirement-note",
      problem: `drops ${match[1]!.toLowerCase()} ${match[2]} with no retirement note above it`,
      fix: RETIREMENT_FIX,
    }));
}

function notNullFindings(live: string): Omit<MigrationFinding, "migration">[] {
  const pattern = /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?([^;]*)/gi;
  return [...live.matchAll(pattern)]
    .filter((match) => /\bNOT\s+NULL\b/i.test(match[2] ?? ""))
    .filter((match) => !/\bDEFAULT\b/i.test(match[2] ?? ""))
    .map((match) => ({
      rule: "add-not-null-column-without-default",
      problem: `adds NOT NULL column ${match[1]} with no DEFAULT`,
      fix:
        "give it a DEFAULT, or add it nullable now and set NOT NULL in a later release after a " +
        "backfill — an INSERT from the image still serving does not name this column, and " +
        "without a default every one of those inserts fails the moment the migration lands.",
    }));
}

function backfillFindings(live: string): Omit<MigrationFinding, "migration">[] {
  const backfills = [...live.matchAll(/\bUPDATE\s+[^;]*/gi)];
  return [...live.matchAll(/\bALTER\s+COLUMN\s+"?(\w+)"?\s+SET\s+NOT\s+NULL/gi)]
    .filter(
      (match) =>
        !backfills.some(
          (backfill) => backfill.index < match.index && backfill[0].includes(match[1]!),
        ),
    )
    .map((match) => ({
      rule: "set-not-null-without-backfill",
      problem: `sets ${match[1]} NOT NULL with no UPDATE filling it earlier in the same migration`,
      fix:
        "expand, migrate, contract: backfill the column (an UPDATE in this migration, or a job " +
        "in an earlier release), make every writer stop leaving it null, and set NOT NULL only " +
        "in the release after that — a row the previous image inserts must still be legal.",
    }));
}

function renameFindings(live: string): Omit<MigrationFinding, "migration">[] {
  const columns = [...live.matchAll(/\bRENAME\s+COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/gi)].map(
    (match) => ({
      rule: "rename-in-place",
      problem: `renames column ${match[1]} to ${match[2]}`,
      fix: RENAME_FIX,
    }),
  );
  const tables = [
    ...live.matchAll(
      /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([\w.]+)"?\s+RENAME\s+TO\s+"?(\w+)"?/gi,
    ),
  ].map((match) => ({
    rule: "rename-in-place",
    problem: `renames table ${match[1]} to ${match[2]}`,
    fix: RENAME_FIX,
  }));
  return [...columns, ...tables];
}

/** Every rule the Postgres scanner applies to one migration folder's SQL. */
export function scanPostgresMigration({ name, sql }: MigrationSource): MigrationFinding[] {
  const live = maskComments(sql);
  return [
    ...dropFindings(sql, live),
    ...notNullFindings(live),
    ...backfillFindings(live),
    ...renameFindings(live),
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

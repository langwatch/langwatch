/**
 * The pure text rules behind the Postgres migration scanner: no imports, no
 * I/O — the test reads the folders and passes the SQL in. Every finding carries
 * its own fix, the way a lint message does. ADR-155.
 */

/** The rules added with S9 and W-01; the test holds only migrations written after them to these. */
export const FLOOR_AND_LOCK_RULES: ReadonlySet<string> = new Set([
  "new-foreign-key",
  "retirement-note-above-floor",
  "set-not-null-on-populated-column",
  "enum-recreated",
  "unique-or-validated-constraint-on-existing-table",
  "plain-index-on-existing-table",
  "alter-column-type",
]);

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

type Finding = Omit<MigrationFinding, "migration">;

/** `3.20.1`, `v3.20.1` or `langwatch@v3.20.1` as comparable numbers; null when it is no release. */
export function parseRelease(text: string): [number, number, number] | null {
  const match = /^(?:langwatch@)?v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i.exec(text.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function releaseAtOrBelow({ release, floor }: { release: string; floor: string }): boolean {
  const note = parseRelease(release);
  const bound = parseRelease(floor);
  if (!note || !bound) return false;
  for (const [index, part] of note.entries()) {
    if (part !== bound[index]) return part < bound[index]!;
  }
  return true;
}

function noteBefore(sql: string, statementOffset: number): string | undefined {
  return [...sql.matchAll(RETIREMENT_MARKER)]
    .filter((match) => match.index < statementOffset)
    .at(-1)?.[1];
}

const IDENT = '(?:"[^"]+"|\\w+)(?:\\s*\\.\\s*(?:"[^"]+"|\\w+))?';

/** `"public"."Project"` and `Project` both become `project`. */
function bareName(identifier: string): string {
  return identifier.replaceAll('"', "").split(".").at(-1)!.trim().toLowerCase();
}

function statementsOf(live: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let offset = 0;
  for (const part of live.split(";")) {
    if (part.trim().length > 0) {
      out.push({ text: part, offset: offset + part.length - part.trimStart().length });
    }
    offset += part.length + 1;
  }
  return out;
}

/** Tables this migration creates are empty and unread, so locking rules leave them alone. */
function createdTables(live: string): Set<string> {
  const pattern = new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})`, "gi");
  return new Set([...live.matchAll(pattern)].map((match) => bareName(match[1]!)));
}

function alteredTable(statement: string): string | undefined {
  const pattern = new RegExp(
    `^\\s*ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${IDENT})`,
    "i",
  );
  const match = pattern.exec(statement);
  return match ? bareName(match[1]!) : undefined;
}

/** The ops pre-build note: a comment above it naming `INDEX CONCURRENTLY` and this index. */
function hasPrebuildNote({ sql, offset, index }: { sql: string; offset: number; index: string }) {
  const comments = [...sql.matchAll(/--[^\n]*|\/\*[\s\S]*?\*\//g)]
    .filter((match) => match.index < offset)
    .map((match) => match[0])
    .join("\n");
  return /INDEX\s+CONCURRENTLY/i.test(comments) && comments.includes(index);
}

function dropFindings({
  sql,
  live,
  floor,
}: {
  sql: string;
  live: string;
  floor: string;
}): Finding[] {
  const pattern = /\bDROP\s+(COLUMN|TABLE|TYPE)\s+(?:IF\s+EXISTS\s+)?"?([\w.]+)"?/gi;
  return [...live.matchAll(pattern)].flatMap((match): Finding[] => {
    const what = `${match[1]!.toLowerCase()} ${match[2]}`;
    if (!retiredBefore(sql, match.index)) {
      return [
        {
          rule: "drop-without-retirement-note",
          problem: `drops ${what} with no retirement note above it`,
          fix: RETIREMENT_FIX,
        },
      ];
    }
    const release = noteBefore(sql, match.index)!;
    if (releaseAtOrBelow({ release, floor })) return [];
    const unparsed = parseRelease(release) === null;
    return [
      {
        rule: "retirement-note-above-floor",
        problem: unparsed
          ? `drops ${what} under a note naming "${release}", which is not a release`
          : `drops ${what} under a note naming ${release}, above the LTS floor ${floor}`,
        fix: unparsed
          ? "name the release that stopped using it as MAJOR.MINOR.PATCH, for example `-- contract: retired in 3.21.0`."
          : `an installation on ${floor} still reads it, and the floor is the oldest release the ` +
            `window promises to serve. Keep the ${match[1]!.toLowerCase()} until ` +
            `packages/upgrade/releases/lts-floor.json names ${release} or later; the first ` +
            `release cut after the floor reaches ${release} is the first one this drop may ship in.`,
      },
    ];
  });
}

function notNullFindings(live: string): Finding[] {
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

const SET_NOT_NULL_FIX =
  "SET NOT NULL scans the table under ACCESS EXCLUSIVE, and a row the still-serving image " +
  "inserts without the column then fails. A backfill beside it does not help: the old image " +
  "writes nulls after it. Enforce it in the application, or add `CHECK (col IS NOT NULL) NOT " +
  "VALID` and VALIDATE it in a later release, once every writer fills the column.";

function setNotNullFindings({ live, created }: Scoped): Finding[] {
  return statementsOf(live).flatMap(({ text }) => {
    const table = alteredTable(text);
    if (!table || created.has(table)) return [];
    return [...text.matchAll(/\bALTER\s+COLUMN\s+"?(\w+)"?\s+SET\s+NOT\s+NULL/gi)].map((match) => ({
      rule: "set-not-null-on-populated-column",
      problem: `sets ${match[1]} NOT NULL on existing table ${table}`,
      fix: SET_NOT_NULL_FIX,
    }));
  });
}

type Scoped = { live: string; created: Set<string> };

function alterTypeFindings({ live, created }: Scoped): Finding[] {
  return statementsOf(live).flatMap(({ text }) => {
    const table = alteredTable(text);
    if (!table || created.has(table)) return [];
    return [
      ...text.matchAll(/\bALTER\s+COLUMN\s+"?(\w+)"?\s+(?:SET\s+DATA\s+)?TYPE\s+(\S+)/gi),
    ].map((match) => ({
      rule: "alter-column-type",
      problem: `changes the type of ${table}.${match[1]} to ${match[2]}`,
      fix:
        "a type change rewrites the table under ACCESS EXCLUSIVE while the previous image still " +
        "reads and writes the old type. Add a column of the new type, backfill it, write both, " +
        "switch the readers, then retire the old column under the removal rule.",
    }));
  });
}

function enumFindings(live: string): Finding[] {
  const renamed = [
    ...live.matchAll(
      new RegExp(`\\bALTER\\s+TYPE\\s+(${IDENT})\\s+RENAME\\s+TO\\s+(${IDENT})`, "gi"),
    ),
  ].map((match) => ({
    rule: "enum-recreated",
    problem: `renames type ${match[1]} to ${match[2]}, the first step of recreating an enum`,
    fix: ENUM_FIX,
  }));
  const dropped = new Set(
    [...live.matchAll(/\bDROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?([\w".]+)/gi)].map((match) =>
      bareName(match[1]!),
    ),
  );
  const recreated = [...live.matchAll(new RegExp(`\\bCREATE\\s+TYPE\\s+(${IDENT})`, "gi"))]
    .filter((match) => dropped.has(bareName(match[1]!)))
    .map((match) => ({
      rule: "enum-recreated",
      problem: `drops and recreates type ${match[1]}`,
      fix: ENUM_FIX,
    }));
  return [...renamed, ...recreated];
}

const ENUM_FIX =
  "recreating an enum rewrites every column using it and drops the values the previous image " +
  "still writes. Add values with `ALTER TYPE ... ADD VALUE`; to remove one, stop writing it, " +
  "migrate the rows in a later release and leave the value in the type (or add a new type " +
  "and column and retire the old under the removal rule).";

const CONSTRAINT_FIX =
  "building a UNIQUE or PRIMARY KEY constraint, or validating a CHECK or FOREIGN KEY, scans " +
  "the table under a lock and fails on a row the old image can still write. Pre-build the " +
  "index CONCURRENTLY and attach it with `ADD CONSTRAINT ... USING INDEX`, or add the " +
  "constraint `NOT VALID` and `VALIDATE CONSTRAINT` it as its own later step.";

const INDEX_PATTERN = new RegExp(
  `^\\s*CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})\\s+ON\\s+(?:ONLY\\s+)?(${IDENT})`,
  "i",
);

const PREBUILD_FIX =
  "an index build on an existing table blocks its writes for as long as it runs, and " +
  "CONCURRENTLY cannot run inside Prisma's transaction. Put the ops pre-build note above the " +
  "statement: a comment with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` and the index name, as " +
  "in 20261006120000_process_outbox_lease_by_process_index, so an operator builds it ahead.";

function indexAndConstraintFindings({ sql, live, created }: Scoped & { sql: string }): Finding[] {
  return statementsOf(live).flatMap(({ text, offset }): Finding[] => {
    const index = INDEX_PATTERN.exec(text);
    if (index) {
      const [, unique, concurrently, name, table] = index;
      const bare = name!.replaceAll('"', "");
      if (concurrently || created.has(bareName(table!))) return [];
      const noted = hasPrebuildNote({ sql, offset, index: bare });
      if (noted) return [];
      return [
        unique
          ? {
              rule: "unique-or-validated-constraint-on-existing-table",
              problem: `builds unique index ${name} on existing table ${bareName(table!)} with no ops pre-build note`,
              fix: `${CONSTRAINT_FIX} A unique index may instead carry the ops pre-build note. ${PREBUILD_FIX}`,
            }
          : {
              rule: "plain-index-on-existing-table",
              problem: `builds index ${name} on existing table ${bareName(table!)} with no ops pre-build note`,
              fix: PREBUILD_FIX,
            },
      ];
    }
    const table = alteredTable(text);
    if (!table || created.has(table)) return [];
    const pattern =
      /\bADD\s+(?:CONSTRAINT\s+"?\w+"?\s+)?(UNIQUE|PRIMARY\s+KEY|EXCLUDE|CHECK|FOREIGN\s+KEY)\b/i;
    const match = pattern.exec(text);
    if (!match) return [];
    const kind = match[1]!.toUpperCase().replace(/\s+/g, " ");
    const safe = /^(CHECK|FOREIGN KEY)$/.test(kind)
      ? /\bNOT\s+VALID\b/i.test(text)
      : /\bUSING\s+INDEX\b/i.test(text);
    if (safe) return [];
    return [
      {
        rule: "unique-or-validated-constraint-on-existing-table",
        problem: `adds a ${kind} constraint to existing table ${table} that is validated at once`,
        fix: CONSTRAINT_FIX,
      },
    ];
  });
}

const FOREIGN_KEY_FIX =
  "no new foreign key (Alex, 2026-10-06): keep the reference a plain column with an index. " +
  "The owning service deletes its dependents; another module's go by a fact and that " +
  "module's purge subscriber. The postgres-migration skill shows the shape.";

function foreignKeyFindings(live: string): Finding[] {
  return statementsOf(live)
    .filter(({ text }) => /\b(?:FOREIGN\s+KEY|REFERENCES)\b/i.test(text))
    .map(({ text }) => {
      const table = alteredTable(text) ?? [...createdTables(text)][0] ?? "a table";
      return {
        rule: "new-foreign-key",
        problem: `adds a foreign key on ${table}`,
        fix: FOREIGN_KEY_FIX,
      };
    });
}

function renameFindings(live: string): Finding[] {
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

/**
 * Every rule the Postgres scanner applies to one migration folder's SQL. `floor` is the
 * LTS floor release: a retirement note must name a release at or below it.
 */
export function scanPostgresMigration({
  name,
  sql,
  floor,
}: MigrationSource & { floor: string }): MigrationFinding[] {
  const live = maskComments(sql);
  const created = createdTables(live);
  return [
    ...dropFindings({ sql, live, floor }),
    ...notNullFindings(live),
    ...setNotNullFindings({ live, created }),
    ...alterTypeFindings({ live, created }),
    ...enumFindings(live),
    ...indexAndConstraintFindings({ sql, live, created }),
    ...foreignKeyFindings(live),
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

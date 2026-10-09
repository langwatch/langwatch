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

/** The finding for a note that names a release the floor has not reached, or none. */
function noteAboveFloor({
  sql,
  offset,
  what,
  floor,
}: {
  sql: string;
  offset: number;
  what: string;
  floor: string;
}): Finding[] {
  const release = [...sql.matchAll(RETIREMENT_MARKER)]
    .filter((match) => match.index < offset)
    .at(-1)?.[1];
  if (release === undefined || releaseAtOrBelow({ release, floor })) return [];
  const unparsed = parseRelease(release) === null;
  return [
    {
      rule: "retirement-note-above-floor",
      problem: unparsed
        ? `${what} under a note naming "${release}", which is not a release`
        : `${what} under a note naming ${release}, above the LTS floor ${floor}`,
      fix: unparsed
        ? "name the release that stopped using it as MAJOR.MINOR.PATCH, for example `-- contract: retired in 3.21.0`."
        : `an installation on ${floor} still reads it, and the floor is the oldest release the ` +
          `window promises to serve. Keep it until packages/upgrade/releases/lts-floor.json names ` +
          `${release} or later; the first release cut after the floor reaches ${release} is the ` +
          `first one this change may ship in.`,
    },
  ];
}

/** A table or view name with backticks, the database prefix and goose placeholders removed. */
function bareName(identifier: string): string {
  return identifier.replaceAll("`", "").split(".").at(-1)!.trim().toLowerCase();
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

function dropFindings({
  up,
  liveUp,
  floor,
}: {
  up: string;
  liveUp: string;
  floor: string;
}): Finding[] {
  const pattern = /\bDROP\s+(COLUMN|TABLE|VIEW|DICTIONARY)\s+(?:IF\s+EXISTS\s+)?`?([\w.${}]+)`?/gi;
  return [...liveUp.matchAll(pattern)].flatMap((match): Finding[] => {
    const what = `drops ${match[1]!.toLowerCase()} ${match[2]}`;
    if (retiredBefore(up, match.index)) {
      return noteAboveFloor({ sql: up, offset: match.index, what, floor });
    }
    return [
      {
        rule: "drop-without-retirement-note",
        problem: `${what} with no retirement note above it`,
        fix: RETIREMENT_FIX,
      },
    ];
  });
}

function typeChangeFindings({
  up,
  liveUp,
  floor,
}: {
  up: string;
  liveUp: string;
  floor: string;
}): Finding[] {
  const pattern = /\bMODIFY\s+COLUMN\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?\s+(\S+)/gi;
  return [...liveUp.matchAll(pattern)]
    .filter(
      (match) => !/^(TTL|CODEC|REMOVE|COMMENT|SETTINGS|MODIFY)\b/.test(match[2]!.toUpperCase()),
    )
    .flatMap((match): Finding[] => {
      const what = `changes the type of column ${match[1]} to ${match[2]}`;
      if (retiredBefore(up, match.index)) {
        return noteAboveFloor({ sql: up, offset: match.index, what, floor });
      }
      return [
        {
          rule: "modify-column-type",
          problem: what,
          fix:
            "a type change rewrites every part while the previous image still decodes the old " +
            "type. Add a column with the new type, backfill it, switch the readers, then retire " +
            "the old one under the removal rule. Setting only a CODEC, TTL or comment: write " +
            "`MODIFY COLUMN <name> CODEC(...)` without restating the type, which is then not a " +
            "type change at all.",
        },
      ];
    });
}

function variableSizeFindings(liveUp: string): Finding[] {
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

function blockFindings(up: string): Finding[] {
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

function downFindings(down: string): Finding[] {
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

const IF_EXISTS_FIX =
  "write IF NOT EXISTS on every CREATE and ADD, IF EXISTS on every DROP, MODIFY and RENAME. " +
  "goose takes no ClickHouse lock and a half-applied migration is re-run: without the guard the " +
  "second run fails on the first statement that already took effect, and the step never finishes.";

function ifExistsFindings(liveUp: string): Finding[] {
  return statementsIn(liveUp).flatMap((statement): Finding[] => {
    const create =
      /^CREATE\s+(?!OR\s+REPLACE\b)(?:TEMPORARY\s+)?((?:MATERIALIZED\s+)?(?:LIVE\s+)?(?:TABLE|VIEW|DICTIONARY|DATABASE))\s+(?!IF\s+NOT\s+EXISTS\b)(\S+)/i.exec(
        statement,
      );
    if (create) {
      return [
        {
          rule: "ddl-without-if-exists",
          problem: `creates ${create[1]!.toLowerCase()} ${create[2]} without IF NOT EXISTS`,
          fix: IF_EXISTS_FIX,
        },
      ];
    }
    const drop = /^DROP\s+(TABLE|VIEW|DICTIONARY|DATABASE)\s+(?!IF\s+EXISTS\b)(\S+)/i.exec(
      statement,
    );
    if (drop) {
      return [
        {
          rule: "ddl-without-if-exists",
          problem: `drops ${drop[1]!.toLowerCase()} ${drop[2]} without IF EXISTS`,
          fix: IF_EXISTS_FIX,
        },
      ];
    }
    if (!/^ALTER\s+TABLE\b/i.test(statement)) return [];
    const actions =
      /\b(ADD|DROP|MODIFY|RENAME)\s+(COLUMN|INDEX|PROJECTION)\s+(?!IF\s+(?:NOT\s+)?EXISTS\b)`?(\w+)/gi;
    return [...statement.matchAll(actions)].map((match) => ({
      rule: "ddl-without-if-exists",
      problem:
        `${match[1]!.toLowerCase()}s ${match[2]!.toLowerCase()} ${match[3]} without ` +
        `${match[1]!.toUpperCase() === "ADD" ? "IF NOT EXISTS" : "IF EXISTS"}`,
      fix: IF_EXISTS_FIX,
    }));
  });
}

const VIEW_FIX =
  "a view dropped and created again, or its query modified in place, fails every read in the " +
  "gap and changes what the previous image selects. Same columns: CREATE OR REPLACE VIEW, or " +
  "EXCHANGE TABLES for a materialized one. Different columns: create the view under a new name, " +
  "switch the readers, then retire the old one under the removal rule.";

function viewFindings(liveUp: string): Finding[] {
  const statements = statementsIn(liveUp);
  const dropped = statements.flatMap((statement, index) => {
    const match = /^DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?(\S+)/i.exec(statement);
    return match ? [{ name: bareName(match[1]!), raw: match[1]!, index }] : [];
  });
  const recreated = dropped
    .filter((view) =>
      statements.some((statement, index) => {
        const match = /^CREATE\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i.exec(
          statement,
        );
        return index > view.index && match !== null && bareName(match[1]!) === view.name;
      }),
    )
    .map((view) => ({
      rule: "view-replaced-in-place",
      problem: `drops view ${view.raw} and creates it again in the same migration`,
      fix: VIEW_FIX,
    }));
  const modified = statements.flatMap((statement) => {
    const match = /^ALTER\s+TABLE\s+(\S+)\s+MODIFY\s+QUERY\b/i.exec(statement);
    return match
      ? [
          {
            rule: "view-replaced-in-place",
            problem: `modifies the query of view ${match[1]} in place`,
            fix: VIEW_FIX,
          },
        ]
      : [];
  });
  return [...recreated, ...modified];
}

/**
 * Every rule the ClickHouse scanner applies to one goose migration file. `floor` is the LTS
 * floor release: a retirement note must name a release at or below it.
 */
export function scanClickHouseMigration({
  name,
  sql,
  floor,
}: MigrationSource & { floor: string }): MigrationFinding[] {
  const { up, down } = gooseHalves(sql);
  const liveUp = maskComments(up);
  return [
    ...dropFindings({ up, liveUp, floor }),
    ...typeChangeFindings({ up, liveUp, floor }),
    ...variableSizeFindings(liveUp),
    ...blockFindings(up),
    ...downFindings(down),
    ...ifExistsFindings(liveUp),
    ...viewFindings(liveUp),
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

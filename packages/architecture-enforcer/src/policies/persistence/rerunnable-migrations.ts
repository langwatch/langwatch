import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ArchitectureViolation } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * Every Prisma migration newer than the marker is re-runnable, so the upgrade runner may mark a
 * failed one rolled back and apply it again (round 21, S3-RETRY). Prisma applies statement by
 * statement, so each must be a no-op the second time: specs/rerunnable-migrations.feature.
 */

const POLICY = "rerunnable-migrations";
const PRISMA_MIGRATIONS = "packages/prisma-client/prisma/migrations";
export const RERUNNABLE_MARKER_FILE = "packages/upgrade/src/stepping/rerunnable-migrations.ts";
const MARKER = /export const RERUNNABLE_PRISMA_FROM = "([^"]+)";/;
const ALLOWED =
  "Every statement in a Prisma migration newer than RERUNNABLE_PRISMA_FROM must be a no-op when run a second time, so the upgrade can mark a cancelled migration rolled back and apply it again (round 21, S3-RETRY).";

const IDENT = String.raw`(?:"[^"]+"|[A-Z_][\w$]*)(?:\.(?:"[^"]+"|[A-Z_][\w$]*))?`;
const DO_GUARD =
  "wrap it in a DO $$ BEGIN IF NOT EXISTS (<catalogue check>) THEN ... END IF; END $$ guard";
const ADD_COLUMN = /^ADD (?:COLUMN )?IF NOT EXISTS /;
const CONSTRAINT = /^ADD (?:CONSTRAINT|PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK|EXCLUDE)\b/;
const ALTER_COLUMN = new RegExp(
  String.raw`^ALTER (?:COLUMN )?${IDENT} (?:SET DEFAULT|DROP DEFAULT|SET NOT NULL|DROP NOT NULL|(?:SET DATA )?TYPE|SET STATISTICS|SET STORAGE|SET \(|RESET \(|DROP IDENTITY IF EXISTS|DROP EXPRESSION IF EXISTS)`,
);
const SAFE_TABLE_ACTIONS =
  /^(?:DROP (?:COLUMN |CONSTRAINT )?IF EXISTS |VALIDATE CONSTRAINT |(?:ENABLE|DISABLE|FORCE|NO FORCE) ROW LEVEL SECURITY$|(?:ENABLE|DISABLE)(?: ALWAYS| REPLICA)? TRIGGER |SET \(|RESET \(|OWNER TO |SET (?:LOGGED|UNLOGGED)$|REPLICA IDENTITY |CLUSTER ON |SET WITHOUT CLUSTER$|SET TABLESPACE )/;
const ALWAYS_SAFE =
  /^(?:UPDATE|DELETE|COMMENT ON|GRANT|REVOKE|SET|RESET|SELECT|ANALYZE|REINDEX|REFRESH MATERIALIZED VIEW|TRUNCATE|BEGIN|COMMIT|DO)\b/;
const GUARDED_CREATE = new RegExp(
  String.raw`^CREATE (?:(?:UNLOGGED |TEMP |TEMPORARY )?TABLE|SCHEMA|SEQUENCE|EXTENSION|MATERIALIZED VIEW|(?:UNIQUE )?INDEX) IF NOT EXISTS |^CREATE OR REPLACE |^ALTER TYPE ${IDENT} ADD VALUE IF NOT EXISTS |^ALTER (?:TABLE|INDEX|SEQUENCE|VIEW) IF EXISTS ${IDENT} RENAME TO |^DROP (?:[A-Z]+ )+IF EXISTS `,
);

/** One statement of a migration, comments blanked, with the line it starts on. */
export type MigrationStatement = { text: string; line: number };

/**
 * Splits SQL at top-level semicolons, skipping comments, quoted strings and identifiers and
 * dollar-quoted bodies, so a `DO $$ ... $$` block or a `';'` literal stays one statement.
 */
export function splitStatements(sql: string): MigrationStatement[] {
  const statements: MigrationStatement[] = [];
  let current = "";
  let index = 0;
  const flush = () => {
    const leading = current.length - current.trimStart().length;
    const consumed = sql.slice(0, index - current.length + leading);
    if (current.trim())
      statements.push({ text: current.trim(), line: consumed.split("\n").length });
    current = "";
  };
  while (index < sql.length) {
    const rest = sql.slice(index);
    const skip = commentLength(rest);
    if (skip > 0) {
      current += sql.slice(index, index + skip).replace(/[^\n]/g, " ");
      index += skip;
      continue;
    }
    const quoted = quotedLength(rest);
    if (quoted > 0) {
      current += sql.slice(index, index + quoted);
      index += quoted;
      continue;
    }
    if (sql[index] === ";") {
      index++;
      flush();
      continue;
    }
    current += sql[index];
    index++;
  }
  flush();
  return statements;
}

function commentLength(rest: string): number {
  if (rest.startsWith("--")) {
    const end = rest.indexOf("\n");
    return end === -1 ? rest.length : end;
  }
  if (rest.startsWith("/*")) {
    const end = rest.indexOf("*/", 2);
    return end === -1 ? rest.length : end + 2;
  }
  return 0;
}

function quotedLength(rest: string): number {
  const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(rest);
  if (dollar) {
    const end = rest.indexOf(dollar[0], dollar[0].length);
    return end === -1 ? rest.length : end + dollar[0].length;
  }
  const quote = rest[0];
  if (quote !== "'" && quote !== '"') return 0;
  for (let at = 1; at < rest.length; at++) {
    if (rest[at] !== quote) continue;
    if (rest[at + 1] === quote) at++;
    else return at + 1;
  }
  return rest.length;
}

/** Splits an ALTER TABLE's actions at top-level commas. */
function tableActions(actions: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let at = 0; at < actions.length; at++) {
    const quoted = quotedLength(actions.slice(at));
    if (quoted > 0) {
      current += actions.slice(at, at + quoted);
      at += quoted - 1;
      continue;
    }
    const char = actions[at]!;
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  return [...parts, current.trim()].filter(Boolean);
}

function actionProblem(action: string): string | null {
  const safe = [ADD_COLUMN, SAFE_TABLE_ACTIONS, ALTER_COLUMN].some((form) => form.test(action));
  if (safe) return null;
  if (CONSTRAINT.test(action))
    return `adding a constraint fails when it already exists: ${DO_GUARD} on pg_constraint`;
  if (action.startsWith("ADD ")) return "a second ADD COLUMN fails: write ADD COLUMN IF NOT EXISTS";
  if (action.startsWith("DROP "))
    return "a second DROP fails: write DROP COLUMN IF EXISTS or DROP CONSTRAINT IF EXISTS";
  if (action.startsWith("RENAME "))
    return `a second rename finds no old name: ${DO_GUARD} on information_schema.columns`;
  return `it is not known to be re-runnable: write a guarded form or ${DO_GUARD}`;
}

/** Why one statement fails or changes something the second time, or null when it is re-runnable. */
export function rerunnableProblem(statement: string): string | null {
  const text = statement.replace(/\s+/g, " ").trim().toUpperCase();
  if (/^CREATE (?:UNIQUE )?INDEX CONCURRENTLY\b/.test(text))
    return "a cancelled concurrent build leaves an INVALID index that IF NOT EXISTS then keeps: build it without CONCURRENTLY, or ops pre-builds it (the pre-build note) and the migration runs CREATE INDEX IF NOT EXISTS";
  if (GUARDED_CREATE.test(text) || ALWAYS_SAFE.test(text)) return null;
  if (/^INSERT INTO\b/.test(text))
    return /\bON CONFLICT\b/.test(text)
      ? null
      : "a second INSERT duplicates its rows or fails: add ON CONFLICT DO NOTHING (or DO UPDATE)";
  const table = new RegExp(
    String.raw`^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?${IDENT}\*? (.+)$`,
  ).exec(text);
  if (table) {
    const problems = tableActions(table[1]!).map(actionProblem).filter(Boolean);
    return problems.length === 0 ? null : [...new Set(problems)].join("; ");
  }
  return bareFormProblem(text);
}

/** The fix for a statement written without its guard, or the not-recognised refusal. */
function bareFormProblem(text: string): string {
  if (/^CREATE (?:UNLOGGED |TEMP |TEMPORARY )?TABLE\b/.test(text))
    return "a second CREATE TABLE fails: write CREATE TABLE IF NOT EXISTS";
  if (/^CREATE (?:UNIQUE )?INDEX\b/.test(text))
    return "a second CREATE INDEX fails: write CREATE INDEX IF NOT EXISTS";
  if (/^CREATE (?:SCHEMA|SEQUENCE|EXTENSION|MATERIALIZED VIEW)\b/.test(text))
    return "a second CREATE fails: add IF NOT EXISTS";
  if (/^DROP\b/.test(text)) return "a second DROP fails: add IF EXISTS";
  if (/^ALTER TYPE \S+ ADD VALUE\b/.test(text))
    return "a second ADD VALUE fails: write ADD VALUE IF NOT EXISTS";
  if (/\bRENAME\b/.test(text))
    return `a second rename finds no old name: write ALTER ... IF EXISTS <old> RENAME TO, or ${DO_GUARD}`;
  if (/^CREATE (?:TYPE|DOMAIN|POLICY|TRIGGER|FUNCTION|VIEW|RULE)\b/.test(text))
    return `a second CREATE fails: write CREATE OR REPLACE where it exists, or ${DO_GUARD}`;
  return `it is not known to be re-runnable: write a guarded form or ${DO_GUARD}`;
}

/** The marker's folder name, or a violation naming the marker file. */
function readMarker(root: string): string | ArchitectureViolation {
  const file = join(root, RERUNNABLE_MARKER_FILE);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const marker = MARKER.exec(text)?.[1];
  if (!marker)
    return {
      policy: POLICY,
      file,
      message: `${RERUNNABLE_MARKER_FILE} must export RERUNNABLE_PRISMA_FROM = "<folder>"; the policy cannot tell which migrations it guards.`,
      allowed: ALLOWED,
    };
  if (!existsSync(join(root, PRISMA_MIGRATIONS, marker)))
    return {
      policy: POLICY,
      file,
      message: `RERUNNABLE_PRISMA_FROM names ${marker}, which ${PRISMA_MIGRATIONS} does not hold; name an existing folder.`,
      allowed: ALLOWED,
    };
  return marker;
}

/** The check over a root: one violation per statement that is not re-runnable. */
export function lintRerunnableMigrationsAt({ root }: { root: string }): ArchitectureViolation[] {
  const directory = join(root, PRISMA_MIGRATIONS);
  if (!existsSync(directory)) return [];
  const marker = readMarker(root);
  if (typeof marker !== "string") return [marker];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name > marker)
    .map((entry) => join(directory, entry.name, "migration.sql"))
    .filter((file) => existsSync(file))
    .toSorted()
    .flatMap((file) =>
      splitStatements(readFileSync(file, "utf8")).flatMap(({ text, line }) => {
        const problem = rerunnableProblem(text);
        if (problem === null) return [];
        const snippet = text.replace(/\s+/g, " ").slice(0, 80);
        return [
          {
            policy: POLICY,
            file,
            line,
            message: `"${snippet}" is not re-runnable: ${problem}.`,
            allowed: ALLOWED,
          } satisfies ArchitectureViolation,
        ];
      }),
    );
}

/** The registry entry. */
export function lintRerunnableMigrations(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return lintRerunnableMigrationsAt({ root: snapshot.root });
}

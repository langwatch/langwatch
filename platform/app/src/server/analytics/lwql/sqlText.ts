/**
 * LangWatchQL analytics SQL — the one home for SQL text safety.
 *
 * Every module under `lwql/` emits SQL as text. Neither ClickHouse nor
 * PostgreSQL binds an identifier as a parameter, and a row policy's `USING`
 * expression is text by definition, so escaping and identifier validation
 * happen at every emission site.
 *
 * They live here rather than beside each of those sites because a private copy
 * per module is a copy that can be relaxed — or simply forgotten at one
 * interpolation — while every other copy still reads as if the rule held
 * everywhere. One implementation means one place a reviewer has to look and one
 * place a test can pin.
 *
 * @see ./provisioning.ts — the access model, as statements
 * @see ./views.ts — the `analytics.*` views, as statements
 */

/**
 * Longest statement any LangWatchQL surface accepts.
 *
 * A shape ceiling rather than a cost one — the cost ceilings are pinned
 * server-side by the settings profile. It exists so that pathological input is
 * refused before it reaches a parser fed attacker-controlled text, and it sits
 * far above any query the LangWatchQL catalog's analytical shapes produce.
 *
 * One constant rather than one per surface, because the surfaces are not
 * independent: a statement the workbench will run has to be one the workbench
 * can save, and a saved chart has to be one the query endpoint will accept. Two
 * numbers that agree today are two numbers that can disagree later, and the
 * failure that produces — a query that runs but cannot be stored — surfaces to
 * a member as the product losing their work.
 */
export const MAX_LWQL_LENGTH = 50_000;

/**
 * Identifier shape both ClickHouse and PostgreSQL accept unquoted.
 *
 * Names come from deployment configuration rather than from a request, so the
 * check is a programming-error guard, not a customer-facing one — hence a plain
 * `Error`.
 */
export const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Returns `value` if it is a safe identifier, throws otherwise.
 *
 * `role` names what the identifier is for, so a provisioning failure says which
 * configured name was rejected rather than only that one was.
 */
export function assertIdentifier(value: string, role: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `lwql: ${role} must match ${String(SAFE_IDENTIFIER)}, got "${value}"`,
    );
  }
  return value;
}

/** ClickHouse string literal: backslash-escaped, single quotes doubled out. */
export function clickHouseLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** PostgreSQL string literal under `standard_conforming_strings`: quote-doubled. */
export function postgresLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * A PostgreSQL identifier as SQL: always double-quoted.
 *
 * Not optional the way it is on the ClickHouse side. Prisma names its tables
 * and columns in the case the model declares (`Annotation`, `projectId`), and
 * PostgreSQL folds an unquoted identifier to lower case, so an unquoted
 * `Annotation` resolves to a relation that does not exist. Every PostgreSQL
 * identifier this package emits goes through here — quoting some of them and
 * not others is the same bug, deferred until a deployment names a schema in
 * mixed case.
 */
export function postgresQuoted(value: string): string {
  return `"${assertIdentifier(value, "PostgreSQL identifier")}"`;
}

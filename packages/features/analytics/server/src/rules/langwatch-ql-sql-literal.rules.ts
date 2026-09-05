/**
 * LangWatchQL analytics SQL — escaping a value into statement text.
 *
 * Neither ClickHouse nor PostgreSQL binds an identifier as a parameter, and a
 * row policy's `USING` expression is text by definition, so escaping happens at
 * every emission site. It lives in one module rather than a private copy per
 * site because a copy is a copy that can be relaxed — or simply forgotten at
 * one interpolation — while every other copy still reads as if the rule held
 * everywhere.
 *
 * Identifier validation, which refuses rather than escapes, is the throwing
 * half and lives in `../services/langwatch-ql-sql-text.service.ts`.
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
 * check the service applies is a programming-error guard, not a
 * customer-facing one.
 */
export const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** ClickHouse string literal: backslash-escaped, single quotes doubled out. */
export function clickHouseLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** PostgreSQL string literal under `standard_conforming_strings`: quote-doubled. */
export function postgresLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

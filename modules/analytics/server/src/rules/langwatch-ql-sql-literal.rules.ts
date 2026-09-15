/**
 * LangWatchQL analytics SQL — escaping a value into statement text. Neither ClickHouse nor
 * PostgreSQL binds an identifier as a parameter, and a row policy's `USING` expression is text
 * by definition, so escaping happens at every emission site.
 */

/**
 * Identifier shape both ClickHouse and PostgreSQL accept unquoted. Names come from deployment
 * configuration rather than from a request, so the check the service applies is a
 * programming-error guard, not a customer-facing one.
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

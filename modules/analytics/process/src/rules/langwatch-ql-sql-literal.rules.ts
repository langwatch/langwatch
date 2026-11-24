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

/** `value` when it matches `SAFE_IDENTIFIER`; `role` names the rejected name in the error. */
export function assertSafeIdentifier({ value, role }: { value: string; role: string }): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`lwql: ${role} must match ${String(SAFE_IDENTIFIER)}, got "${value}"`);
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

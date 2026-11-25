/**
 * Bash quoting for the dev-script tests, which generate small shell scripts and
 * have to put real paths in them.
 */

/**
 * A value as exactly one Bash word. Paths from `mkdtemp`/`process.execPath`
 * can contain spaces, which would otherwise split into two arguments. Single
 * quotes take everything literally; a quote itself needs close/escape/reopen.
 */
export function asBashWord(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

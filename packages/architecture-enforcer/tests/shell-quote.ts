/**
 * Bash quoting for the dev-script tests, which generate small shell scripts and
 * have to put real paths in them.
 */

/**
 * A value as exactly one Bash word. Paths from `mkdtemp`/`process.execPath`
 * can contain spaces, which would otherwise split into two arguments and
 * fail as a flaky-looking test rather than a wrong one. Single quotes take
 * everything literally, so the only escape needed is for a quote itself:
 * close, emit an escaped quote, reopen.
 */
export function asBashWord(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

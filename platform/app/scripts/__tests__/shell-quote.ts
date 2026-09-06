/**
 * Bash quoting for the dev-script tests, which generate small shell scripts and
 * have to put real paths in them.
 */

/**
 * A value as exactly one Bash word.
 *
 * The paths these tests interpolate come from `mkdtemp` and `process.execPath`,
 * so a TMPDIR or a node install with a space in it would otherwise split one
 * argument into two. The command then fails to start and the test reads as
 * flaky rather than as wrong.
 *
 * Single quotes take everything literally, so the only case to handle is a
 * single quote itself: close the string, emit an escaped quote, reopen it.
 */
export function asBashWord(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

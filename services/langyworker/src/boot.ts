/**
 * Stdio discipline, MUST be the first import: side effects run before any
 * other module (pi SDK), so nothing writes a non-protocol byte to fd 1.
 * Captures `process.stdout.write`, redirects the rest to stderr, sets `PI_OFFLINE`.
 */

type StdoutWrite = typeof process.stdout.write;

export const rawStdoutWrite: StdoutWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = ((
  chunk: Parameters<StdoutWrite>[0],
  encodingOrCb?: unknown,
  cb?: unknown,
) => {
  return (process.stderr.write as (...args: unknown[]) => boolean)(chunk, encodingOrCb, cb);
}) as StdoutWrite;

console.log = console.error.bind(console);
console.info = console.error.bind(console);
console.warn = console.error.bind(console);

if (process.env.PI_OFFLINE === undefined) {
  process.env.PI_OFFLINE = "1";
}

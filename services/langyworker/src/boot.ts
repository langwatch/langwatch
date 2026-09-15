/**
 * Stdio discipline. This module MUST be the first import of the entry point:
 * its side effects run before any other module (the pi SDK included) can run
 * theirs, so nothing can ever write a non-protocol byte to fd 1.
 *
 * - The real `process.stdout.write` is captured as `rawStdoutWrite`; the
 *   protocol writer is its only caller.
 * - `process.stdout.write` is then redirected to stderr, which also covers
 *   `console.log` / `console.info` / `console.warn` (they write through
 *   `process.stdout.write`).
 * - `PI_OFFLINE` is set so the pi SDK never refreshes model catalogs over the
 *   network: the worker's egress is proxied and the only model in play comes
 *   from the generated models.json.
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

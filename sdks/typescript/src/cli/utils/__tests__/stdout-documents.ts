/**
 * The stdout a machine-readable command run produced, read back as documents.
 *
 * A caller that asked for `--format json` gets exactly one document per
 * result and nothing else on stdout (specs/features/test-suite-cli.feature,
 * "no other line is printed on stdout"). A filter that only kept the lines
 * starting with `{` would let a stray progress line through unnoticed, so
 * every line is parsed here, and a line that is not JSON fails the test that
 * asked.
 *
 * Reads the `console.log` spy the calling suite installed, plus a
 * `process.stdout.write` spy when the suite installed one: the port prints
 * through `console.log`, and the spy on the raw stream is what catches a
 * future direct write.
 *
 * Not named `*.test.ts` on purpose: vitest's `include` is `src/**\/*.test.ts`,
 * so this module is imported by the suites rather than collected as one.
 */
import { vi } from "vitest";

const isMocked = (fn: unknown): fn is ReturnType<typeof vi.fn> =>
  typeof fn === "function" && vi.isMockFunction(fn);

/** Every line written to stdout since the spies were cleared. */
export const stdoutLines = (): string[] => {
  const logged = isMocked(console.log)
    ? vi.mocked(console.log).mock.calls.map((call) => call.map(String).join(" "))
    : [];
  const written = isMocked(process.stdout.write)
    ? vi
        .mocked(process.stdout.write)
        .mock.calls.map((call) => String(call[0]).replace(/\n$/, ""))
    : [];
  return [...logged, ...written];
};

/**
 * Every line on stdout, each one required to be a JSON document.
 *
 * Returned as the printed strings so a test can parse the one it expects;
 * a line that does not parse throws with that line in the message.
 */
export const stdoutDocuments = (): string[] => {
  const lines = stdoutLines();
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      throw new Error(
        `stdout carried a line that is not a JSON document: ${JSON.stringify(line)}`,
      );
    }
  }
  return lines;
};

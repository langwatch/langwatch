/**
 * A machine-format run's stdout read back as documents: every line must parse
 * (specs/features/test-suite-cli.feature). Not named `*.test.ts`, so vitest
 * imports it rather than collecting it.
 */
import { vi } from "vitest";

const isMocked = (fn: unknown): fn is ReturnType<typeof vi.fn> =>
  typeof fn === "function" && vi.isMockFunction(fn);

/** Every line written to stdout since the spies were cleared. */
export const stdoutLines = (): string[] => {
  const logged = isMocked(console.log)
    ? vi.mocked(console.log).mock.calls.map((call) => call.map(String).join(" "))
    : [];
  // Read as a property rather than a method reference: the suites replace it
  // with a spy, and there is no `this` to lose.
  const write = (process.stdout as unknown as { write: unknown }).write;
  const written = isMocked(write)
    ? write.mock.calls.map((call) => String(call[0]).replace(/\n$/, ""))
    : [];
  return [...logged, ...written];
};

/**
 * Every line on stdout, each one required to be a JSON document; a line that
 * does not parse throws with that line in the message.
 */
export const stdoutDocuments = (): string[] => {
  const lines = stdoutLines();
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      throw new Error(`stdout carried a line that is not a JSON document: ${JSON.stringify(line)}`);
    }
  }
  return lines;
};

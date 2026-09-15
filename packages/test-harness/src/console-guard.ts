import { afterEach, beforeEach } from "vitest";

const CONSOLE_METHODS = ["log", "info", "warn", "error"] as const;
type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

let allowedForCurrentTest = false;

/**
 * Opts the current test out of the console guard below - for the rare test
 * that asserts on console output itself, or drives a dependency that logs
 * directly. Resets automatically after the test.
 */
export function allowConsole(): void {
  allowedForCurrentTest = true;
}

// LANGWATCH_TEST_LOGS=1 restores today's behaviour (console output visible)
// for a whole run, the same escape hatch the logger itself honours.
const guardDisabled = process.env.LANGWATCH_TEST_LOGS === "1";

/**
 * Fails a test with a clear message when test code (not the logger, which
 * pino writes through directly) calls console.log/info/warn/error during it.
 * Loaded as a `setupFiles` entry for `kind: "unit"` suites only - it runs its
 * hooks the moment this module is imported.
 */
if (!guardDisabled) {
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();

  beforeEach(() => {
    allowedForCurrentTest = false;
    for (const method of CONSOLE_METHODS) {
      originals.set(method, console[method].bind(console));
      console[method] = (...args: unknown[]) => {
        if (allowedForCurrentTest) {
          originals.get(method)?.(...args);
          return;
        }
        throw new Error(
          `console.${method} was called during a test. Use createTestLogger from ` +
            `@langwatch/test-harness to assert on logging, or call allowConsole() to opt ` +
            `this test out deliberately. Message: ${args.map(String).join(" ")}`,
        );
      };
    }
  });

  afterEach(() => {
    for (const method of CONSOLE_METHODS) {
      const original = originals.get(method);
      if (original) console[method] = original;
    }
    originals.clear();
    allowedForCurrentTest = false;
  });
}

/**
 * Memoized logger is safe: request fields from mixin at log-call time (async-local),
 * not at construction. Tests verify this by asserting written records.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getCurrentContext, runWithContext } from "../context/core.ts";
import {
  configureLogger,
  createLogger,
  registerLogContextProvider,
  resetLoggerCache,
} from "../logger.ts";

/** Everything the loggers wrote while `run` executed, parsed. */
function emitted(run: () => void): Record<string, unknown>[] {
  const written: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    run();
  } finally {
    process.stdout.write = realWrite;
  }

  return written
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("given createLogger memoises by name", () => {
  beforeEach(() => {
    configureLogger({ environment: "test", level: "info" });
    resetLoggerCache();
    registerLogContextProvider(() => {
      const context = getCurrentContext();
      return context ? { ...context } : {};
    });
  });

  afterEach(() => {
    resetLoggerCache();
  });

  describe("when the same name is requested twice", () => {
    /** @scenario Asking for the same logger twice returns the same logger */
    it("hands back the same instance", () => {
      expect(createLogger("langwatch:test:reuse")).toBe(createLogger("langwatch:test:reuse"));
    });
  });

  describe("when composition configures the same process twice", () => {
    it("keeps the existing factory and cached logger", () => {
      const logger = createLogger("langwatch:test:configured-once");

      configureLogger({ environment: "test", level: "info" });

      expect(createLogger("langwatch:test:configured-once")).toBe(logger);
    });
  });

  describe("when two names are requested", () => {
    /** @scenario Different names get different loggers */
    it("keeps them separate", () => {
      expect(createLogger("langwatch:test:one")).not.toBe(createLogger("langwatch:test:two"));
    });
  });

  describe("when one name is requested with and without context disabled", () => {
    /** @scenario A logger with context disabled never serves a caller that wants context */
    it("keeps them separate so the context-disabled one never serves the other", () => {
      expect(createLogger("langwatch:test:ctx")).not.toBe(
        createLogger("langwatch:test:ctx", { disableContext: true }),
      );
    });
  });

  describe("when two requests share the memoised logger", () => {
    /** @scenario Two requests sharing one logger each log their own project */
    it("writes each request's own projectId", () => {
      const records = emitted(() => {
        const logger = createLogger("langwatch:test:shared");

        runWithContext({ projectId: "project-first" }, () => {
          logger.info("first request");
        });
        runWithContext({ projectId: "project-second" }, () => {
          logger.info("second request");
        });
      });

      expect(records.map((record) => record.projectId)).toEqual([
        "project-first",
        "project-second",
      ]);
    });

    /** @scenario A line written outside a request names no project */
    it("writes no project at all outside a request", () => {
      const [record] = emitted(() => {
        createLogger("langwatch:test:shared").info("no request in scope");
      });

      expect(record?.projectId).toBeUndefined();
    });
  });
});

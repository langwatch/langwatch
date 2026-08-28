/**
 * `createLogger` hands out one memoised logger per name, and the thing that
 * makes that safe is where the request fields come from.
 *
 * Constructing a pino logger is expensive — a stack capture per call to work
 * out the caller, plus a level cache and bindings rebuilt each time — and the
 * app calls `createLogger` from 400+ sites, some of them per-instance class
 * fields. Memoising removes all of it.
 *
 * The risk memoising introduces is that a shared instance carries one
 * request's organizationId / projectId / userId onto another request's lines.
 * It does not, because those fields are not bound at construction: they come
 * from pino's `mixin`, which is invoked per log call and reads the async-local
 * context at that moment. That property is the reason this file exists, so it
 * is asserted against records the logger actually wrote rather than against
 * the implementation.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCurrentContext, runWithContext } from "../context/core";
import { createLogger, registerLogContextProvider, resetLoggerCache } from "../logger";

const ORIGINAL_ENV = { ...process.env };

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
    process.env.PINO_LOG_LEVEL = "info";
    resetLoggerCache();
    registerLogContextProvider(() => {
      const context = getCurrentContext();
      return context ? { ...context } : {};
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetLoggerCache();
  });

  describe("when the same name is requested twice", () => {
    /** @scenario Asking for the same logger twice returns the same logger */
    it("hands back the same instance", () => {
      expect(createLogger("langwatch:test:reuse")).toBe(createLogger("langwatch:test:reuse"));
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

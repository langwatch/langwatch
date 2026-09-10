// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../logger.ts";

/**
 * `createLogger` is silenced under vitest by default (LANGWATCH_TEST_LOGS
 * unset), and this package's own vitest.config.ts sets LANGWATCH_TEST_LOGS=1
 * so its other suites see real levels. These tests exercise the override
 * directly by toggling the env var around each case.
 */
describe("createLogger under vitest", () => {
  const original = process.env.LANGWATCH_TEST_LOGS;

  afterEach(() => {
    if (original === undefined) delete process.env.LANGWATCH_TEST_LOGS;
    else process.env.LANGWATCH_TEST_LOGS = original;
  });

  describe("given LANGWATCH_TEST_LOGS is unset", () => {
    it("returns a silent logger", () => {
      delete process.env.LANGWATCH_TEST_LOGS;

      const logger = createLogger("silenced");

      expect(logger.level).toBe("silent");
    });
  });

  describe("given LANGWATCH_TEST_LOGS=1", () => {
    it("restores the configured level", () => {
      process.env.LANGWATCH_TEST_LOGS = "1";

      const logger = createLogger("restored");

      expect(logger.level).not.toBe("silent");
    });
  });

  describe("given LANGWATCH_TEST_LOGS=debug", () => {
    it("sets that level", () => {
      process.env.LANGWATCH_TEST_LOGS = "debug";

      const logger = createLogger("debug-level");

      expect(logger.level).toBe("debug");
    });
  });
});

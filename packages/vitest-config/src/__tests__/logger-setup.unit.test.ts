// @vitest-environment node
import { createLogger } from "@langwatch/observability";
import { describe, expect, it } from "vitest";

import { configureTestLogging } from "../logger-setup.ts";

/** The test process's logger, as its boot seam configures it from LANGWATCH_TEST_LOGS. */
describe("configureTestLogging", () => {
  describe("given LANGWATCH_TEST_LOGS is unset", () => {
    it("silences the logger", () => {
      configureTestLogging(undefined);

      expect(createLogger("silenced").level).toBe("silent");
    });
  });

  describe("given LANGWATCH_TEST_LOGS=1", () => {
    it("restores the test default level", () => {
      configureTestLogging("1");

      expect(createLogger("restored").level).not.toBe("silent");
    });
  });

  describe("given LANGWATCH_TEST_LOGS=debug", () => {
    it("sets that level", () => {
      configureTestLogging("debug");

      expect(createLogger("debug-level").level).toBe("debug");
    });
  });
});

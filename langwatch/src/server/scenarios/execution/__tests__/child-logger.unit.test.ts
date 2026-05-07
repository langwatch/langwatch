/**
 * @vitest-environment node
 *
 * Unit tests for child-logger — the bridge that propagates the parent's
 * structured logger context across the parent → child process boundary.
 *
 * @see specs/scenarios/observability-context.feature
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("~/utils/logger/server", () => {
  const make = (bindings: Record<string, unknown> = {}) => ({
    bindings: () => bindings,
    child: (extra: Record<string, unknown>) =>
      make({ ...bindings, ...extra }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  });
  return {
    createLogger: vi.fn(() => make({})),
  };
});

import {
  encodeScenarioLogContext,
  decodeScenarioLogContext,
  createChildProcessLogger,
  SCENARIO_LOG_CONTEXT_ENV,
} from "../child-logger";

describe("child-logger", () => {
  describe("given a parent context with all bindings", () => {
    describe("when the child decodes and rebuilds its logger", () => {
      /** @scenario child process logger inherits the parent's context bindings */
      it("returns a logger whose bindings include all 3 keys", () => {
        const encoded = encodeScenarioLogContext({
          projectId: "proj_1",
          batchRunId: "batch_1",
          scenarioRunId: "run_1",
        });

        const logger = createChildProcessLogger("test", {
          [SCENARIO_LOG_CONTEXT_ENV]: encoded,
        }) as unknown as { bindings: () => Record<string, unknown> };

        expect(logger.bindings()).toEqual({
          projectId: "proj_1",
          batchRunId: "batch_1",
          scenarioRunId: "run_1",
        });
      });
    });
  });

  describe("given the context env var is unset", () => {
    describe("when the child requests its base logger", () => {
      /** @scenario child process tolerates missing context env var */
      it("returns a logger without bindings and without throwing", () => {
        const logger = createChildProcessLogger("test", {}) as unknown as {
          bindings: () => Record<string, unknown>;
        };
        expect(logger).toBeDefined();
        expect(logger.bindings()).toEqual({});
      });
    });
  });

  describe("given the context env var contains malformed JSON", () => {
    describe("when the child requests its base logger", () => {
      /** @scenario child process tolerates invalid context JSON */
      it("returns a logger without bindings and emits a warning", () => {
        const stderr = vi
          .spyOn(process.stderr, "write")
          .mockImplementation(() => true);

        const logger = createChildProcessLogger("test", {
          [SCENARIO_LOG_CONTEXT_ENV]: "{not valid json",
        });

        expect(logger).toBeDefined();
        expect(stderr).toHaveBeenCalledWith(
          expect.stringContaining("not valid JSON"),
        );

        stderr.mockRestore();
      });
    });
  });

  describe("encode/decode round-trip", () => {
    it("drops undefined and empty-string values", () => {
      const encoded = encodeScenarioLogContext({
        projectId: "proj_1",
        batchRunId: undefined,
        scenarioRunId: "",
      });
      const decoded = decodeScenarioLogContext(encoded);
      expect(decoded).toEqual({ projectId: "proj_1" });
    });

    it("decode returns empty object for unset env var", () => {
      expect(decodeScenarioLogContext(undefined)).toEqual({});
    });
  });
});

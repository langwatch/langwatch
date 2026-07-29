/**
 * @vitest-environment node
 *
 * The failure handler's `info` line used to carry `error.substring(0, 100)` —
 * a positional slice of a string that is usually
 * "Child process exited with code N: <stderr>". The stderr half is the
 * runner's own output about the customer's conversation, so the first 100
 * characters of it are content, not diagnostics.
 *
 * These tests pin what replaced it: a classified reason and the exit code at
 * `info`, and the raw window no higher than `debug`.
 *
 * @see specs/scenarios/scenario-failure-handler.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENT_TRANSCRIPT =
  "The agent told Ada Lovelace her card ending 4471 was declined";

const loggerCalls = vi.hoisted(
  () =>
    [] as {
      level: "debug" | "info" | "warn" | "error";
      fields: unknown;
      message: unknown;
    }[],
);

vi.mock("@langwatch/observability", () => {
  const record =
    (level: "debug" | "info" | "warn" | "error") =>
    (fields: unknown, message?: unknown) => {
      loggerCalls.push({ level, fields, message });
    };
  const logger: Record<string, unknown> = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ simulations: { finishRun: async () => undefined } }),
}));

import { ScenarioFailureHandler } from "../scenario-failure-handler";

const baseParams = {
  projectId: "proj_123",
  scenarioId: "scen_456",
  setId: "set_789",
  batchRunId: "batch_abc",
  scenarioRunId: "scenariorun_1",
};

describe("given a child-process failure whose stderr quotes the conversation", () => {
  beforeEach(async () => {
    loggerCalls.length = 0;
    await ScenarioFailureHandler.create().ensureFailureEventsEmitted({
      ...baseParams,
      error: `Child process exited with code 7: ECONNREFUSED — ${AGENT_TRANSCRIPT}`,
    });
  });

  describe("when the handler announces the failure", () => {
    it("keeps the raw failure text out of info and above", () => {
      const aboveDebug = JSON.stringify(
        loggerCalls.filter((call) => call.level !== "debug"),
      );
      expect(aboveDebug).not.toContain(AGENT_TRANSCRIPT);
    });

    it("reports the exit code and a classified reason instead", () => {
      const announcement = loggerCalls.find(
        (call) => call.message === "Emitting failure events via event-sourcing",
      );
      expect(announcement?.level).toBe("info");
      expect(announcement?.fields).toMatchObject({
        scenarioRunId: "scenariorun_1",
        exitCode: 7,
        errorCode: "scenario_platform_unreachable",
      });
      expect(announcement?.fields).not.toHaveProperty("error");
    });

    it("keeps the raw window at debug for a local reproduction", () => {
      const rawWindow = loggerCalls.find(
        (call) => call.message === "Scenario failure, raw error window",
      );
      expect(rawWindow?.level).toBe("debug");
      expect(JSON.stringify(rawWindow?.fields)).toContain("ECONNREFUSED");
    });
  });
});

describe("given a failure that did not come from a child process", () => {
  beforeEach(async () => {
    loggerCalls.length = 0;
    await ScenarioFailureHandler.create().ensureFailureEventsEmitted({
      ...baseParams,
      error: "Scenario execution timed out",
    });
  });

  describe("when the handler announces the failure", () => {
    it("omits the exit code rather than inventing one", () => {
      const announcement = loggerCalls.find(
        (call) => call.message === "Emitting failure events via event-sourcing",
      );
      expect(
        (announcement?.fields as { exitCode?: number }).exitCode,
      ).toBeUndefined();
      expect(announcement?.fields).toMatchObject({
        errorCode: "scenario_execution_timeout",
      });
    });
  });
});

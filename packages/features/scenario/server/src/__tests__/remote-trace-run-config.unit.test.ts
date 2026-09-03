/**
 * @vitest-environment node
 *
 * Unit tests for the remote-trace fragment of the SDK run configuration,
 * plus a structural pin on the child process entry point (it runs main() at
 * import, so its wiring is asserted on the source rather than by importing
 * it).
 *
 * @see specs/scenarios/remote-trace-judging.feature
 */

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildRemoteTraceRunConfig, TRACE_WAIT_CAP_MS } from "../index";

describe("buildRemoteTraceRunConfig", () => {
  const base = {
    traceWaitTimeoutMs: undefined,
    langwatchEndpoint: "https://app.langwatch.test",
    langwatchApiKey: "sk-lw-test",
  };

  describe("given an http target", () => {
    /** @scenario "An http target runs with remote trace fetching enabled" */
    it("enables remote fetching and carries the run's endpoint and key", () => {
      const config = buildRemoteTraceRunConfig({
        ...base,
        targetType: "http",
      });

      expect(config).toEqual({
        fetchRemoteTraces: true,
        traceWaitExtensionMs: TRACE_WAIT_CAP_MS,
        langwatch: {
          endpoint: "https://app.langwatch.test",
          apiKey: "sk-lw-test",
        },
      });
    });

    describe("when the judge asks to wait for incomplete traces", () => {
      /** @scenario "The judge's extra wait uses the platform cap" */
      it("always passes the 30 second cap as the wait extension", () => {
        const config = buildRemoteTraceRunConfig({
          ...base,
          targetType: "http",
          traceWaitTimeoutMs: 10_000,
        });

        expect(TRACE_WAIT_CAP_MS).toBe(30_000);
        expect(config).toMatchObject({
          traceWaitExtensionMs: TRACE_WAIT_CAP_MS,
        });
      });
    });

    describe("when the job carries a wait budget", () => {
      /** @scenario "The child process passes the wait budget through" */
      it("passes it as the SDK's trace wait timeout, and omits it otherwise", () => {
        const withBudget = buildRemoteTraceRunConfig({
          ...base,
          targetType: "http",
          traceWaitTimeoutMs: 45_000,
        });
        const withoutBudget = buildRemoteTraceRunConfig({
          ...base,
          targetType: "http",
        });

        expect(withBudget).toMatchObject({ traceWaitTimeoutMs: 45_000 });
        // Absent, not null: the SDK's own default must apply.
        expect(withoutBudget).not.toHaveProperty("traceWaitTimeoutMs");
      });
    });
  });

  describe("given a prompt, code or workflow target", () => {
    /** @scenario "Only http targets run with remote fetching" */
    it("contributes nothing to the run configuration", () => {
      for (const targetType of ["prompt", "code", "workflow"] as const) {
        expect(
          buildRemoteTraceRunConfig({
            ...base,
            targetType,
            traceWaitTimeoutMs: 45_000,
          }),
        ).toEqual({});
      }
    });
  });
});

describe("scenario child process wiring", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../adapters/scenario-child-execution.adapter.ts"),
    "utf8",
  );

  describe("when it constructs the agents for a run", () => {
    /** @scenario "The judge for an http target is the SDK judge with remote fetching enabled" */
    it("builds one SDK judge for every target type and spreads the remote-trace config into the run", () => {
      // One judge path: the SDK judge, no per-target judge wrapper.
      expect(source.match(/judgeAgent\(\{/g)).toHaveLength(1);
      expect(source).toContain("ScenarioRunner.judgeAgent({");
      // Remote fetching arrives through the run configuration alone.
      expect(source).toContain("...buildRemoteTraceRunConfig({");
      expect(source).toContain("traceWaitTimeoutMs: jobData.traceWaitTimeoutMs");
    });
  });
});

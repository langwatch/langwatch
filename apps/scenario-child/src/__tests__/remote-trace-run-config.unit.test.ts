/**
 * Unit tests for the remote-trace fragment of the SDK run configuration,
 * @vitest-environment node
 * @see specs/scenarios/remote-trace-judging.feature
 */

import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  buildRemoteTraceRunConfig,
  TRACE_QUIET_PERIOD_MS,
  TRACE_WAIT_CAP_MS,
} from "../rules/remote-trace-run.rules.ts";

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
        traceQuietPeriodMs: TRACE_QUIET_PERIOD_MS,
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

    describe("when the verdict reads the trace", () => {
      /** @scenario "The child process passes the quiet period through" */
      /** @scenario "The child process passes the default quiet period when the job names none" */
      it("passes a seven second quiet period for every remote-fetching target", () => {
        expect(TRACE_QUIET_PERIOD_MS).toBe(7_000);
        for (const targetType of ["http", "connected"] as const) {
          expect(buildRemoteTraceRunConfig({ ...base, targetType })).toMatchObject({
            traceQuietPeriodMs: TRACE_QUIET_PERIOD_MS,
          });
        }
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

  describe("when the job carries the resolved quiet period and trace wait", () => {
    /** @scenario "The child process passes the job's quiet period and trace wait through" */
    it("passes both through and keeps the extension at the cap", () => {
      expect(
        buildRemoteTraceRunConfig({
          ...base,
          targetType: "http",
          traceWaitTimeoutMs: 90_000,
          traceQuietPeriodMs: 12_000,
        }),
      ).toMatchObject({
        traceWaitTimeoutMs: 90_000,
        traceQuietPeriodMs: 12_000,
        traceWaitExtensionMs: TRACE_WAIT_CAP_MS,
      });
    });

    it("passes a zero quiet period through rather than the default", () => {
      expect(
        buildRemoteTraceRunConfig({ ...base, targetType: "http", traceQuietPeriodMs: 0 }),
      ).toMatchObject({ traceQuietPeriodMs: 0 });
    });
  });

  describe("given a connected target", () => {
    /** @scenario "A connected target is judged from its remote traces" */
    it("fetches remote traces the way it does for an http target", () => {
      expect(buildRemoteTraceRunConfig({ ...base, targetType: "connected" })).toEqual(
        buildRemoteTraceRunConfig({ ...base, targetType: "http" }),
      );
      expect(buildRemoteTraceRunConfig({ ...base, targetType: "connected" })).toMatchObject({
        fetchRemoteTraces: true,
      });
    });
  });

  describe("given a prompt, code, workflow or voice target", () => {
    /** @scenario "Only http targets run with remote fetching" */
    it("contributes nothing to the run configuration", () => {
      for (const targetType of ["prompt", "code", "workflow", "voice"] as const) {
        expect(
          buildRemoteTraceRunConfig({
            ...base,
            targetType,
            traceWaitTimeoutMs: 45_000,
            traceQuietPeriodMs: 12_000,
          }),
        ).toEqual({});
      }
    });
  });
});

describe("scenario child process wiring", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../services/scenario-child-execution.service.ts"),
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
      expect(source).toContain("traceQuietPeriodMs: jobData.traceQuietPeriodMs");
    });
  });
});

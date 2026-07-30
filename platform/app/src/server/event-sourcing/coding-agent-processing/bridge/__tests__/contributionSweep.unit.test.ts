import { describe, expect, it, vi } from "vitest";
import type { SpanFactsContribution } from "../../schema";
import { runContributionSweep } from "../contributionSweep";

function makeSpanCandidate(spanId: string): SpanFactsContribution {
  return {
    tenantId: "tenant-1",
    sessionId: "session-1",
    sessionKeySource: "provider",
    agent: "claude_code",
    occurredAt: 1_000,
    acceptedAt: 1_000,
    traceId: "trace-1",
    spanId,
    name: "claude_code.tool",
    startTimeUnixMs: 1_000,
    endTimeUnixMs: 1_100,
    statusCode: 1,
    facts: {},
    scopeName: null,
  };
}

describe("given the contribution sweep", () => {
  describe("when every candidate dispatches successfully", () => {
    it("dispatches every signal's candidates and records the tick", async () => {
      const dispatchSpanFacts = vi.fn().mockResolvedValue(undefined);
      const recordTick = vi.fn().mockResolvedValue(undefined);

      const run = runContributionSweep({
        listSpanCandidates: async () => [
          makeSpanCandidate("span-1"),
          makeSpanCandidate("span-2"),
        ],
        listLogCandidates: async () => [],
        listMetricCandidates: async () => [],
        dispatchSpanFacts,
        dispatchLogFacts: vi.fn(),
        dispatchMetricFacts: vi.fn(),
        recordTick,
      });

      const outcome = await run();

      expect(dispatchSpanFacts).toHaveBeenCalledTimes(2);
      expect(recordTick).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ dispatched: 2, failed: 0 });
    });
  });

  describe("when one signal's candidate listing fails", () => {
    it("still sweeps the other two signals, and raises after recording the tick", async () => {
      const dispatchLogFacts = vi.fn().mockResolvedValue(undefined);
      const recordTick = vi.fn().mockResolvedValue(undefined);

      const run = runContributionSweep({
        listSpanCandidates: async () => {
          throw new Error("span candidate store unavailable");
        },
        listLogCandidates: async () => [
          {
            tenantId: "tenant-1",
            sessionId: "session-1",
            sessionKeySource: "provider",
            agent: "claude_code",
            occurredAt: 1_000,
            acceptedAt: 1_000,
            recordId: "record-1",
            traceId: null,
            spanId: null,
            timeUnixMs: 1_000,
            severityNumber: null,
            providerKind: "anthropic",
            scopeName: null,
            facts: {},
          },
        ],
        listMetricCandidates: async () => [],
        dispatchSpanFacts: vi.fn(),
        dispatchLogFacts,
        dispatchMetricFacts: vi.fn(),
        recordTick,
      });

      await expect(run()).rejects.toThrow("span candidate store unavailable");
      expect(dispatchLogFacts).toHaveBeenCalledTimes(1);
      expect(recordTick).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a dispatch fails", () => {
    it("raises rather than swallowing the failure — nothing here reports success on a partial sweep", async () => {
      const run = runContributionSweep({
        listSpanCandidates: async () => [makeSpanCandidate("span-1")],
        listLogCandidates: async () => [],
        listMetricCandidates: async () => [],
        dispatchSpanFacts: vi
          .fn()
          .mockRejectedValue(new Error("dispatch failed")),
        dispatchLogFacts: vi.fn(),
        dispatchMetricFacts: vi.fn(),
        recordTick: vi.fn().mockResolvedValue(undefined),
      });

      await expect(run()).rejects.toThrow("dispatch failed");
    });
  });

  describe("when recordTick itself fails", () => {
    it("does not lose the sweep's own outcome — the tick failure is swallowed, logged, and never masks a dispatch success", async () => {
      const run = runContributionSweep({
        listSpanCandidates: async () => [makeSpanCandidate("span-1")],
        listLogCandidates: async () => [],
        listMetricCandidates: async () => [],
        dispatchSpanFacts: vi.fn().mockResolvedValue(undefined),
        dispatchLogFacts: vi.fn(),
        dispatchMetricFacts: vi.fn(),
        recordTick: vi
          .fn()
          .mockRejectedValue(new Error("tick bookkeeping unavailable")),
      });

      const outcome = await run();
      expect(outcome).toEqual({ dispatched: 1, failed: 0 });
    });
  });
});

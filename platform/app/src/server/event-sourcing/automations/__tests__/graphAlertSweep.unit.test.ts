import type { ProcessContext } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
  GRAPH_ALERT_SWEEP_INTERVAL_MS,
  type GraphAlertSweepPorts,
  graphAlertSweepIntents,
  graphAlertSweepOn,
  graphAlertSweepOnWake,
  initGraphAlertSweepState,
} from "../graphAlertSweep.process";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const ctx: ProcessContext = { processKey: "graphAlertSweep", tenantId: "__global__", now: 10_000 };

function makePorts(overrides: Partial<GraphAlertSweepPorts> = {}): GraphAlertSweepPorts {
  return {
    decideSweepCandidates: vi.fn().mockResolvedValue([]),
    evaluateGraphTrigger: vi.fn().mockResolvedValue(undefined),
    pruneDispatchedIntentsBefore: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("graph alert sweep process", () => {
  describe("given the scheduled process wakes", () => {
    it("emits exactly one evaluateGraph intent keyed on the wake instant, re-arming every interval", () => {
      const wake = graphAlertSweepOnWake(initGraphAlertSweepState(), ctx);

      expect(wake).toEqual({
        state: { lastSweepAt: 10_000, nextWakeAt: 10_000 + GRAPH_ALERT_SWEEP_INTERVAL_MS },
        intents: [{ type: "evaluateGraph", payload: { scheduledFor: 10_000 } }],
        nextWakeAt: 10_000 + GRAPH_ALERT_SWEEP_INTERVAL_MS,
      });
    });
  });

  describe("given an event this singleton scheduler does not act on", () => {
    it("leaves state and the armed wake untouched", () => {
      const armed = { lastSweepAt: 5_000, nextWakeAt: 35_000 };
      const step = graphAlertSweepOn.matchRecorded!(armed, {} as never, ctx);

      expect(step).toEqual({ state: armed, intents: [], nextWakeAt: 35_000 });
    });
  });

  describe("given one sweep candidate", () => {
    it("evaluates the candidate", async () => {
      const evaluateGraphTrigger = vi.fn().mockResolvedValue(undefined);
      const ports = makePorts({
        decideSweepCandidates: vi
          .fn()
          .mockResolvedValue([{ triggerId: "trigger-1", tenantId: "project-1", reason: "heartbeat" as const }]),
        evaluateGraphTrigger,
      });

      await graphAlertSweepIntents(ports).evaluateGraph.deliver({ scheduledFor: 10_000 }, { now: 10_000, tenantId: "__global__" });

      expect(evaluateGraphTrigger).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        tenantId: "project-1",
        reason: "heartbeat",
      });
    });

    it("does not let one candidate's failure stop the rest of the sweep", async () => {
      const evaluateGraphTrigger = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);
      const ports = makePorts({
        decideSweepCandidates: vi.fn().mockResolvedValue([
          { triggerId: "trigger-1", tenantId: "project-1", reason: "heartbeat" as const },
          { triggerId: "trigger-2", tenantId: "project-1", reason: "heartbeat" as const },
        ]),
        evaluateGraphTrigger,
      });

      await expect(
        graphAlertSweepIntents(ports).evaluateGraph.deliver({ scheduledFor: 10_000 }, { now: 10_000, tenantId: "__global__" }),
      ).resolves.toBeUndefined();
      expect(evaluateGraphTrigger).toHaveBeenCalledTimes(2);
    });
  });

  describe("given the sweep's own dispatched outbox rows have accumulated", () => {
    it("prunes rows older than a day, keyed to the wake instant", async () => {
      const pruneDispatchedIntentsBefore = vi.fn().mockResolvedValue(3);
      const ports = makePorts({ pruneDispatchedIntentsBefore });

      await graphAlertSweepIntents(ports).evaluateGraph.deliver({ scheduledFor: 10_000 }, { now: 10_000, tenantId: "__global__" });

      expect(pruneDispatchedIntentsBefore).toHaveBeenCalledWith({ before: 10_000 - 24 * 60 * 60 * 1000 });
    });

    it("still completes the sweep when the retention delete fails", async () => {
      const ports = makePorts({ pruneDispatchedIntentsBefore: vi.fn().mockRejectedValue(new Error("boom")) });

      await expect(
        graphAlertSweepIntents(ports).evaluateGraph.deliver({ scheduledFor: 10_000 }, { now: 10_000, tenantId: "__global__" }),
      ).resolves.toBeUndefined();
    });
  });
});

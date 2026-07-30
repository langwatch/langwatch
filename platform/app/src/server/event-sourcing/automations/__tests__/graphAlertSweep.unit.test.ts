import { describe, expect, it, vi } from "vitest";
import {
  createEvaluateGraphHandler,
  GRAPH_ALERT_SWEEP_INTERVAL_MS,
  type GraphAlertSweepPorts,
  graphAlertSweep,
} from "../process-managers/graphAlertSweep";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function intentContext() {
  return {
    processName: "graphAlertSweep",
    tenantId: "__global__",
    processKey: "graphAlertSweep",
    messageKey: "sweep:10000",
    attempt: 1,
  };
}

describe("graph alert sweep process", () => {
  describe("when the process manager is built", () => {
    it("declares a scheduled singleton wake every thirty seconds", () => {
      expect(graphAlertSweep.kind).toBe("schedule");
      expect(graphAlertSweep.everyMs).toBe(GRAPH_ALERT_SWEEP_INTERVAL_MS);
    });

    it("derives its one intent type from the intents map's own key", () => {
      expect(graphAlertSweep.intentTypes).toEqual([
        "graphAlertSweep/evaluateGraph",
      ]);
    });
  });

  describe("given the scheduled process wakes", () => {
    it("emits exactly one evaluateGraph intent keyed on the wake instant", () => {
      const wake = graphAlertSweep.onWake(
        { lastSweepAt: null },
        graphAlertSweep.intents,
        {
          processKey: "graphAlertSweep",
          tenantId: "__global__",
          at: 10_000,
          now: 10_000,
        },
      );

      expect(wake).toEqual({
        state: { lastSweepAt: 10_000 },
        intents: [
          {
            messageKey: "sweep:10000",
            intentType: "graphAlertSweep/evaluateGraph",
            payload: { scheduledFor: 10_000 },
          },
        ],
      });
    });

    it("carries no wake instant of its own — the schedule owns the cadence", () => {
      const wake = graphAlertSweep.onWake(
        graphAlertSweep.init(),
        graphAlertSweep.intents,
        {
          processKey: "graphAlertSweep",
          tenantId: "__global__",
          at: 10_000,
          now: 10_000,
        },
      );

      expect("nextWakeAt" in wake).toBe(false);
    });
  });

  describe("given one sweep candidate", () => {
    it("evaluates the candidate", async () => {
      const evaluateGraphTrigger = vi.fn().mockResolvedValue(undefined);
      const ports: GraphAlertSweepPorts = {
        decideSweepCandidates: vi.fn().mockResolvedValue([
          {
            triggerId: "trigger-1",
            projectId: "project-1",
            reason: "heartbeat" as const,
          },
        ]),
        evaluateGraphTrigger,
      };

      await createEvaluateGraphHandler(ports)(
        { scheduledFor: 10_000 },
        intentContext(),
      );

      expect(evaluateGraphTrigger).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        projectId: "project-1",
        reason: "heartbeat",
      });
    });

    it("does not let one candidate's failure stop the rest of the sweep", async () => {
      const evaluateGraphTrigger = vi
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(undefined);
      const ports: GraphAlertSweepPorts = {
        decideSweepCandidates: vi.fn().mockResolvedValue([
          {
            triggerId: "trigger-1",
            projectId: "project-1",
            reason: "heartbeat" as const,
          },
          {
            triggerId: "trigger-2",
            projectId: "project-1",
            reason: "heartbeat" as const,
          },
        ]),
        evaluateGraphTrigger,
      };

      await expect(
        createEvaluateGraphHandler(ports)(
          { scheduledFor: 10_000 },
          intentContext(),
        ),
      ).resolves.toBeUndefined();

      expect(evaluateGraphTrigger).toHaveBeenCalledTimes(2);
    });
  });
});

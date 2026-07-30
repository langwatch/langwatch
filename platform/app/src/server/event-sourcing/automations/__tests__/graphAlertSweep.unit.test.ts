import { describe, expect, it, vi } from "vitest";
import {
  createEvaluateGraphHandler,
  GRAPH_ALERT_SWEEP_INTERVAL_MS,
  graphAlertSweepDefinition,
  type GraphAlertSweepPorts,
} from "../process-managers/graphAlertSweep";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("graph alert sweep process", () => {
  describe("when the process manager is built", () => {
    it("declares a scheduled singleton wake every thirty seconds", () => {
      expect(graphAlertSweepDefinition.schedule).toEqual({
        everyMs: GRAPH_ALERT_SWEEP_INTERVAL_MS,
      });
    });

    it("subscribes to no pipeline events", () => {
      expect(graphAlertSweepDefinition.eventTypes).toEqual([]);
    });
  });

  describe("given the scheduled process wakes", () => {
    it("emits exactly one evaluateGraph intent keyed on the wake instant", () => {
      const wake = graphAlertSweepDefinition.onWake!(
        { lastSweepAt: null },
        { key: "graphAlertSweep", tenantId: "__global__", at: 10_000, now: 10_000 },
      );

      expect(wake).toEqual({
        state: { lastSweepAt: 10_000 },
        intents: [
          { messageKey: "sweep:10000", intentType: "evaluateGraph", payload: { scheduledFor: 10_000 } },
        ],
      });
    });
  });

  describe("given one sweep candidate", () => {
    it("evaluates the candidate", async () => {
      const evaluateGraphTrigger = vi.fn().mockResolvedValue(undefined);
      const ports: GraphAlertSweepPorts = {
        decideSweepCandidates: vi.fn().mockResolvedValue([
          { triggerId: "trigger-1", projectId: "project-1", reason: "heartbeat" as const },
        ]),
        evaluateGraphTrigger,
      };

      await createEvaluateGraphHandler(ports)(
        { scheduledFor: 10_000 },
        {
          processName: "graphAlertSweep",
          tenantId: "__global__",
          processKey: "graphAlertSweep",
          messageKey: "sweep:10000",
          attempt: 1,
        },
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
          { triggerId: "trigger-1", projectId: "project-1", reason: "heartbeat" as const },
          { triggerId: "trigger-2", projectId: "project-1", reason: "heartbeat" as const },
        ]),
        evaluateGraphTrigger,
      };

      await expect(
        createEvaluateGraphHandler(ports)(
          { scheduledFor: 10_000 },
          {
            processName: "graphAlertSweep",
            tenantId: "__global__",
            processKey: "graphAlertSweep",
            messageKey: "sweep:10000",
            attempt: 1,
          },
        ),
      ).resolves.toBeUndefined();

      expect(evaluateGraphTrigger).toHaveBeenCalledTimes(2);
    });
  });
});

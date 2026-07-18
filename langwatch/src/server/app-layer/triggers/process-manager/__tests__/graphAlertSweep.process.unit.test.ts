import { describe, expect, it, vi } from "vitest";

import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import {
  GRAPH_ALERT_SWEEP_INTERVAL_MS,
  graphAlertSweepPM,
} from "../graphAlertSweep.process";

describe("graph alert sweep process", () => {
  describe("when the process manager is built", () => {
    it("declares a scheduled singleton wake every thirty seconds", () => {
      const definition = buildProcessManager({
        name: "graphAlertSweep",
        applier: graphAlertSweepPM({
          decideSweepCandidates: vi.fn().mockResolvedValue([]),
          evaluateGraphTrigger: vi.fn().mockResolvedValue(undefined),
          deleteDispatchedBefore: vi.fn().mockResolvedValue(0),
        }),
      });

      expect(definition.config.schedule).toEqual({
        everyMs: GRAPH_ALERT_SWEEP_INTERVAL_MS,
      });
    });

    it("subscribes to no pipeline events", () => {
      const definition = buildProcessManager({
        name: "graphAlertSweep",
        applier: graphAlertSweepPM({
          decideSweepCandidates: vi.fn().mockResolvedValue([]),
          evaluateGraphTrigger: vi.fn().mockResolvedValue(undefined),
          deleteDispatchedBefore: vi.fn().mockResolvedValue(0),
        }),
      });

      expect(definition.config.eventTypes).toEqual([]);
    });
  });

  describe("given one sweep candidate", () => {
    describe("when the evaluateGraph intent runs", () => {
      it("evaluates the candidate with its heartbeat reason", async () => {
        const evaluateGraphTrigger = vi.fn().mockResolvedValue(undefined);
        const definition = buildProcessManager({
          name: "graphAlertSweep",
          applier: graphAlertSweepPM({
            decideSweepCandidates: vi.fn().mockResolvedValue([
              {
                triggerId: "trigger-1",
                projectId: "project-1",
                reason: "heartbeat",
              },
            ]),
            evaluateGraphTrigger,
            deleteDispatchedBefore: vi.fn().mockResolvedValue(0),
            now: () => 10_000,
          }),
        });

        await definition.config.intents.evaluateGraph!.run(
          { scheduledFor: 10_000 },
          {
            processName: "graphAlertSweep",
            projectId: "__global__",
            processKey: "graphAlertSweep",
            tenantId: "__global__",
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
    });
  });
});

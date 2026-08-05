import { describe, expect, it, vi } from "vitest";

import { buildIntentFactories } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { automationProcessDefinition } from "../../__tests__/pipelineTestHarness";
import { GRAPH_ALERT_SWEEP_INTERVAL_MS } from "../graphAlertSweep.process";

describe("graph alert sweep process", () => {
  describe("when the process manager is built", () => {
    it("declares a scheduled singleton wake every thirty seconds", () => {
      const definition = automationProcessDefinition({
        name: "graphAlertSweep",
      });

      expect(definition.config.schedule).toEqual({
        everyMs: GRAPH_ALERT_SWEEP_INTERVAL_MS,
      });
    });

    it("subscribes to no pipeline events", () => {
      const definition = automationProcessDefinition({
        name: "graphAlertSweep",
      });

      expect(definition.config.eventTypes).toEqual([]);
    });
  });

  describe("given one sweep candidate", () => {
    describe("when the scheduled process wakes", () => {
      it("emits the sweep intent, evaluates the candidate, and prunes old intents", async () => {
        const evaluateGraphTrigger = vi.fn().mockResolvedValue(undefined);
        const deleteDispatchedBefore = vi.fn().mockResolvedValue(4);
        const definition = automationProcessDefinition({
          name: "graphAlertSweep",
          deps: {
            sweep: {
              decideSweepCandidates: vi.fn().mockResolvedValue([
                {
                  triggerId: "trigger-1",
                  projectId: "project-1",
                  reason: "heartbeat",
                },
              ]),
              evaluateGraphTrigger,
              deleteDispatchedBefore,
              now: () => 10_000,
            },
          },
        });

        const wake = definition.config.onWake!(
          { lastSweepAt: null },
          {
            at: 10_000,
            now: 10_000,
            key: "graphAlertSweep",
            projectId: "__global__",
            intents: buildIntentFactories(definition.config.intents),
          },
        );
        expect(wake).toEqual({
          state: { lastSweepAt: 10_000 },
          intents: [
            {
              messageKey: "sweep:10000",
              intentType: "evaluateGraph",
              payload: { scheduledFor: 10_000 },
            },
          ],
        });

        const intent = wake.intents![0]!;
        await definition.config.intents.evaluateGraph!.run(intent.payload, {
          processName: "graphAlertSweep",
          projectId: "__global__",
          processKey: "graphAlertSweep",
          tenantId: "__global__",
          messageKey: intent.messageKey,
          attempt: 1,
        });

        expect(evaluateGraphTrigger).toHaveBeenCalledWith({
          triggerId: "trigger-1",
          projectId: "project-1",
          reason: "heartbeat",
        });
        expect(deleteDispatchedBefore).toHaveBeenCalledWith({
          processName: "graphAlertSweep",
          before: 10_000 - 24 * 60 * 60 * 1000,
        });
      });
    });
  });
});

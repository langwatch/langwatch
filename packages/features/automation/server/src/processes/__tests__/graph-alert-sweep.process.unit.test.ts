import { buildIntentFactories } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import {
  automationProcessDefinition,
  InertIntentRetention,
  InertScheduledIntents,
} from "../../ports/__tests__/pipeline-test-harness";
import { GRAPH_ALERT_SWEEP_INTERVAL_MS } from "../graph-alert-sweep.process";

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
        const scheduledIntents = new InertScheduledIntents();
        const retention = new InertIntentRetention();
        vi.spyOn(scheduledIntents, "decideGraphTriggerHeartbeat").mockResolvedValue([
          {
            triggerId: "trigger-1",
            projectId: "project-1",
            reason: "heartbeat-absence",
          },
        ]);
        vi.spyOn(scheduledIntents, "evaluateGraphTrigger").mockImplementation(evaluateGraphTrigger);
        vi.spyOn(retention, "deleteDispatchedBefore").mockImplementation(deleteDispatchedBefore);
        const definition = automationProcessDefinition({
          name: "graphAlertSweep",
          scheduledIntents,
          retention,
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
          reason: "heartbeat-absence",
        });
        expect(deleteDispatchedBefore).toHaveBeenCalledWith({
          processName: "graphAlertSweep",
          before: 10_000 - 24 * 60 * 60 * 1000,
        });
      });
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import { buildIntentFactories } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { automationProcessDefinition } from "../../__tests__/pipelineTestHarness";
import { WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS } from "../webhookDeliveryPrune.process";

describe("webhook delivery prune process", () => {
  describe("when the process manager is built", () => {
    it("declares a scheduled singleton wake once a day", () => {
      const definition = automationProcessDefinition({
        name: "webhookDeliveryPrune",
      });

      expect(definition.config.schedule).toEqual({
        everyMs: WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
      });
    });

    it("subscribes to no pipeline events", () => {
      const definition = automationProcessDefinition({
        name: "webhookDeliveryPrune",
      });

      expect(definition.config.eventTypes).toEqual([]);
    });
  });

  describe("given expired delivery rows", () => {
    describe("when the scheduled process wakes", () => {
      it("emits the prune intent, prunes the log, and prunes old intents", async () => {
        const pruneExpired = vi.fn().mockResolvedValue(12);
        const deleteDispatchedBefore = vi.fn().mockResolvedValue(1);
        const definition = automationProcessDefinition({
          name: "webhookDeliveryPrune",
          deps: {
            prune: { pruneExpired, deleteDispatchedBefore, now: () => 10_000 },
          },
        });

        const wake = definition.config.onWake!(
          { lastPruneAt: null },
          {
            at: 10_000,
            key: "webhookDeliveryPrune",
            projectId: "__global__",
            intents: buildIntentFactories(definition.config.intents),
          },
        );
        expect(wake).toEqual({
          state: { lastPruneAt: 10_000 },
          intents: [
            {
              messageKey: "prune:10000",
              intentType: "prune",
              payload: { scheduledFor: 10_000 },
            },
          ],
        });

        const intent = wake.intents![0]!;
        await definition.config.intents.prune!.run(intent.payload, {
          processName: "webhookDeliveryPrune",
          projectId: "__global__",
          processKey: "webhookDeliveryPrune",
          tenantId: "__global__",
          messageKey: intent.messageKey,
          attempt: 1,
        });

        expect(pruneExpired).toHaveBeenCalledTimes(1);
        expect(deleteDispatchedBefore).toHaveBeenCalledWith({
          processName: "webhookDeliveryPrune",
          before: 10_000 - 7 * 24 * 60 * 60 * 1000,
        });
      });
    });

    describe("when the outbox retention delete fails", () => {
      it("still completes the prune without throwing", async () => {
        const pruneExpired = vi.fn().mockResolvedValue(3);
        const deleteDispatchedBefore = vi
          .fn()
          .mockRejectedValue(new Error("boom"));
        const definition = automationProcessDefinition({
          name: "webhookDeliveryPrune",
          deps: {
            prune: { pruneExpired, deleteDispatchedBefore, now: () => 10_000 },
          },
        });

        await expect(
          definition.config.intents.prune!.run(
            { scheduledFor: 10_000 },
            {
              processName: "webhookDeliveryPrune",
              projectId: "__global__",
              processKey: "webhookDeliveryPrune",
              tenantId: "__global__",
              messageKey: "prune:10000",
              attempt: 1,
            },
          ),
        ).resolves.toBeUndefined();
        expect(pruneExpired).toHaveBeenCalledTimes(1);
      });
    });
  });
});

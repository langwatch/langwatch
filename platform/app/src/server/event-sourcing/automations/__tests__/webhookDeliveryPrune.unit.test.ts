import { describe, expect, it, vi } from "vitest";
import { TRIGGER_SETTLEMENT_PROCESS_NAME } from "../process-managers/triggerSettlement";
import {
  createPruneHandler,
  WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
  type WebhookDeliveryPrunePorts,
  webhookDeliveryPrune,
} from "../process-managers/webhookDeliveryPrune";

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
    processName: WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
    tenantId: "__global__",
    processKey: WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
    messageKey: "prune:10000",
    attempt: 1,
  };
}

describe("webhook delivery prune process", () => {
  describe("when the process manager is built", () => {
    it("declares a scheduled singleton wake once a day", () => {
      expect(webhookDeliveryPrune.kind).toBe("schedule");
      expect(webhookDeliveryPrune.everyMs).toBe(
        WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
      );
    });

    it("derives its one intent type from the intents map's own key", () => {
      expect(webhookDeliveryPrune.intentTypes).toEqual([
        "webhookDeliveryPrune/prune",
      ]);
    });
  });

  describe("given the scheduled process wakes", () => {
    it("emits exactly one prune intent keyed on the wake instant", () => {
      const wake = webhookDeliveryPrune.onWake(
        { lastPruneAt: null },
        webhookDeliveryPrune.intents,
        {
          processKey: WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
          tenantId: "__global__",
          at: 10_000,
          now: 10_000,
        },
      );

      expect(wake).toEqual({
        state: { lastPruneAt: 10_000 },
        intents: [
          {
            messageKey: "prune:10000",
            intentType: "webhookDeliveryPrune/prune",
            payload: { scheduledFor: 10_000 },
          },
        ],
      });
    });
  });

  describe("given expired delivery rows", () => {
    it("prunes the log, then both processes' own dispatched-outbox retention", async () => {
      const pruneExpiredDeliveries = vi.fn().mockResolvedValue(12);
      const pruneDispatchedIntentsBefore = vi.fn().mockResolvedValue(1);
      const ports: WebhookDeliveryPrunePorts = {
        pruneExpiredDeliveries,
        pruneDispatchedIntentsBefore,
      };

      await createPruneHandler(ports)(
        { scheduledFor: 10_000 },
        intentContext(),
      );

      expect(pruneExpiredDeliveries).toHaveBeenCalledTimes(1);
      expect(pruneDispatchedIntentsBefore).toHaveBeenCalledWith(
        expect.objectContaining({
          processName: WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
        }),
      );
      expect(pruneDispatchedIntentsBefore).toHaveBeenCalledWith(
        expect.objectContaining({
          processName: TRIGGER_SETTLEMENT_PROCESS_NAME,
        }),
      );
    });
  });

  describe("given the outbox retention delete fails", () => {
    it("still completes the prune without throwing", async () => {
      const pruneExpiredDeliveries = vi.fn().mockResolvedValue(3);
      const pruneDispatchedIntentsBefore = vi
        .fn()
        .mockRejectedValue(new Error("boom"));
      const ports: WebhookDeliveryPrunePorts = {
        pruneExpiredDeliveries,
        pruneDispatchedIntentsBefore,
      };

      await expect(
        createPruneHandler(ports)({ scheduledFor: 10_000 }, intentContext()),
      ).resolves.toBeUndefined();
      expect(pruneExpiredDeliveries).toHaveBeenCalledTimes(1);
    });
  });
});

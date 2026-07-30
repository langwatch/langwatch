import type { ProcessContext } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import { TRIGGER_SETTLEMENT_PROCESS_NAME } from "../triggerSettlement.process";
import {
  initWebhookDeliveryPruneState,
  WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
  type WebhookDeliveryPrunePorts,
  webhookDeliveryPruneIntents,
  webhookDeliveryPruneOn,
  webhookDeliveryPruneOnWake,
} from "../webhookDeliveryPrune.process";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const ctx: ProcessContext = {
  processKey: WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
  tenantId: "__global__",
  now: 10_000,
};

function makePorts(
  overrides: Partial<WebhookDeliveryPrunePorts> = {},
): WebhookDeliveryPrunePorts {
  return {
    pruneExpiredDeliveries: vi.fn().mockResolvedValue(0),
    pruneDispatchedIntentsBefore: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("webhook delivery prune process", () => {
  describe("given the scheduled process wakes", () => {
    it("emits exactly one prune intent keyed on the wake instant, re-arming every day", () => {
      const wake = webhookDeliveryPruneOnWake(
        initWebhookDeliveryPruneState(),
        ctx,
      );

      expect(wake).toEqual({
        state: {
          lastPruneAt: 10_000,
          nextWakeAt: 10_000 + WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
        },
        intents: [{ type: "prune", payload: { scheduledFor: 10_000 } }],
        nextWakeAt: 10_000 + WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
      });
    });
  });

  describe("given an event this singleton scheduler does not act on", () => {
    it("leaves state and the armed wake untouched", () => {
      const armed = { lastPruneAt: 1_000, nextWakeAt: 86_401_000 };
      const step = webhookDeliveryPruneOn.matchRecorded!(
        armed,
        {} as never,
        ctx,
      );

      expect(step).toEqual({
        state: armed,
        intents: [],
        nextWakeAt: 86_401_000,
      });
    });
  });

  describe("given expired delivery rows", () => {
    it("prunes the log, then both processes' own dispatched-outbox retention", async () => {
      const pruneExpiredDeliveries = vi.fn().mockResolvedValue(12);
      const pruneDispatchedIntentsBefore = vi.fn().mockResolvedValue(1);
      const ports = makePorts({
        pruneExpiredDeliveries,
        pruneDispatchedIntentsBefore,
      });

      await webhookDeliveryPruneIntents(ports).prune.deliver(
        { scheduledFor: 10_000 },
        { now: 10_000, tenantId: "__global__" },
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
      const ports = makePorts({
        pruneExpiredDeliveries,
        pruneDispatchedIntentsBefore: vi
          .fn()
          .mockRejectedValue(new Error("boom")),
      });

      await expect(
        webhookDeliveryPruneIntents(ports).prune.deliver(
          { scheduledFor: 10_000 },
          { now: 10_000, tenantId: "__global__" },
        ),
      ).resolves.toBeUndefined();
      expect(pruneExpiredDeliveries).toHaveBeenCalledTimes(1);
    });
  });
});

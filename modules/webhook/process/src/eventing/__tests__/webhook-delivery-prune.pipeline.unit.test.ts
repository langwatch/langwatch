import type { ProcessManagerApplier } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
} from "../webhook-delivery-prune.process.ts";
import { buildWebhookDeliveryPipeline } from "../webhook-delivery.pipeline.ts";
import type { WebhookDeliveryEvent } from "../webhook-governance-delivery.intent.ts";

/** The two delivery managers are not under test; each only needs to build. */
const idleProcess: ProcessManagerApplier<WebhookDeliveryEvent> = (pm) =>
  pm
    .state(z.object({}), {})
    .schedule({ everyMs: 1 })
    .onWake((state) => ({ state }))
    .intent("idle", z.object({}), async () => {});

describe("given the worker's webhook delivery pipeline", () => {
  describe("when the daily prune schedule wakes", () => {
    /** @scenario "The delivery log is pruned daily without delivery traffic" */
    it("runs the maintenance sweep and retires the prune's own outbox rows", async () => {
      const prune = vi.fn(async () => {});
      const deleteDispatchedBefore = vi.fn(async () => 0);
      const definition = buildWebhookDeliveryPipeline({
        deliveryProcess: idleProcess,
        governanceProcess: idleProcess,
        gatewayEvents: async () => {},
        prune: { prune, deleteDispatchedBefore, now: () => 10_000_000_000 },
      });

      const process = definition.processManagers.get(WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME);
      expect(process?.config.schedule?.everyMs).toBe(WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS);
      await process?.config.intents?.prune?.run(
        { scheduledFor: 0 },
        {
          processName: WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
          projectId: "system",
          processKey: "daily",
          tenantId: "system",
          messageKey: "prune:0",
          attempt: 1,
        },
      );

      expect(prune).toHaveBeenCalledOnce();
      expect(deleteDispatchedBefore).toHaveBeenCalledWith({
        processName: WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
        before: 10_000_000_000 - 7 * 24 * 60 * 60 * 1000,
      });
    });
  });
});

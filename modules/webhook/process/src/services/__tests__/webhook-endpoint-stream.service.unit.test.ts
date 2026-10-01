// SPDX-License-Identifier: Apache-2.0

/**
 * The endpoint stream extraction: `WebhookDeliveryService` (the worker's
 * process manager, composed only from `WebhookDeliveryProcessDeps`) and a
 * direct replay append both ride `WebhookEndpointStreamService` now, over
 * nothing but `{ processStore, now? }`. These cases prove the delegation is
 * behavior-preserving — the same inputs commit the same outbox message
 * whichever call path reaches the service — and that append-then-flush
 * coalescing still holds across the extraction.
 */

import { InMemoryProcessStore } from "@langwatch/eventing";
import type { WebhookEndpointView } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { WEBHOOK_DELIVERY_PROCESS_NAME } from "../../rules/webhook-delivery-contract.rules.ts";
import {
  WebhookDeliveryService,
  type WebhookDeliveryProcessDeps,
} from "../webhook-delivery.service.ts";
import { WebhookEndpointStreamService } from "../webhook-endpoint-stream.service.ts";

const NOW = 1_700_000_000_000;
const ORGANIZATION_ID = "organization-1";

function endpoint(over: Partial<WebhookEndpointView> = {}): WebhookEndpointView {
  return {
    id: "endpoint-1",
    organizationId: ORGANIZATION_ID,
    destinationKind: "http",
    url: "https://example.test/hook",
    sqs: null,
    enabledEvents: ["gateway.request.completed"],
    status: "ACTIVE",
    disabledReason: null,
    disabledAt: null,
    failingSince: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    maxBatchSize: 3,
    maxBatchDelayMs: 0,
    maxInFlight: 2,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...over,
  };
}

function envelope(id = "evt_1") {
  return {
    id,
    type: "gateway.request.completed",
    created: new Date(NOW).toISOString(),
    schema_version: "1" as const,
    data: {},
  };
}

/** Every dependency `WebhookDeliveryService` needs, none of it reachable by
 *  the replay append: `flushEndpointStream`'s only real collaborator is
 *  `processStore`, so a delegated call must never touch the others. */
function deliveryServiceDeps(processStore: InMemoryProcessStore): WebhookDeliveryProcessDeps {
  const unreachable = <T extends object>(name: string): T =>
    new Proxy({} as T, {
      get: () => (): never => {
        throw new Error(`${name} is not under test here`);
      },
    }) as T;

  return {
    processStore,
    endpoints: unreachable("endpoints"),
    pruneExpiredIdempotencyReceipts: unreachable("pruneExpiredIdempotencyReceipts"),
    dispatch: unreachable("dispatch"),
    getPlan: unreachable("getPlan"),
    now: () => NOW,
  };
}

async function committedSendBatches(processStore: InMemoryProcessStore) {
  const ref = {
    processName: WEBHOOK_DELIVERY_PROCESS_NAME,
    projectId: ORGANIZATION_ID,
    processKey: "endpoint:endpoint-1",
  };
  const messages = await processStore.findMessagesByRef({ ref });
  return messages.filter((m) => m.intentType === "sendBatch");
}

describe("WebhookEndpointStreamService", () => {
  describe("given the same replay appended through both call paths", () => {
    it("commits an identical outbox message whether WebhookDeliveryService or the extracted service answers", async () => {
      const directStore = InMemoryProcessStore.createForTesting();
      const viaDeliveryStore = InMemoryProcessStore.createForTesting();

      await WebhookEndpointStreamService.create({
        processStore: directStore,
        now: () => NOW,
      }).appendReplay({
        organizationId: ORGANIZATION_ID,
        endpoint: endpoint(),
        envelope: envelope(),
        replayId: "replay-1",
      });

      await WebhookDeliveryService.create(
        deliveryServiceDeps(viaDeliveryStore),
      ).appendReplayToEndpointStream({
        organizationId: ORGANIZATION_ID,
        endpoint: endpoint(),
        envelope: envelope(),
        replayId: "replay-1",
      });

      const [direct] = await committedSendBatches(directStore);
      const [viaDelivery] = await committedSendBatches(viaDeliveryStore);

      expect(direct).toBeDefined();
      expect(direct?.messageKey).toEqual(viaDelivery?.messageKey);
      expect(direct?.payload).toEqual(viaDelivery?.payload);
    });
  });

  describe("given an append that the coalescing delay holds back, then a due flush", () => {
    it("buffers on append and ships once the flush finds the delay elapsed", async () => {
      const store = InMemoryProcessStore.createForTesting();
      const held = endpoint({ maxBatchDelayMs: 1_000 });

      const service = WebhookEndpointStreamService.create({
        processStore: store,
        now: () => NOW,
      });
      await service.appendReplay({
        organizationId: ORGANIZATION_ID,
        endpoint: held,
        envelope: envelope(),
        replayId: "replay-1",
      });
      expect(await committedSendBatches(store)).toHaveLength(0);

      const laterService = WebhookEndpointStreamService.create({
        processStore: store,
        now: () => NOW + 1_000,
      });
      await laterService.flush({ organizationId: ORGANIZATION_ID, endpoint: held });

      const shipped = await committedSendBatches(store);
      expect(shipped).toHaveLength(1);
      expect(shipped[0]?.payload).toMatchObject({
        organizationId: ORGANIZATION_ID,
        endpointId: "endpoint-1",
      });
    });
  });
});

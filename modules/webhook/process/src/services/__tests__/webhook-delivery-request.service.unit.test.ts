// SPDX-License-Identifier: Apache-2.0

import { InMemoryProcessStore } from "@langwatch/eventing";
import type { WebhookDeliveryRequest } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import type { WebhookId, WebhookSecret } from "../../app/webhook.app.ts";
import { MemoryWebhookEndpointRepository } from "../../repositories/memory/memory.webhook-endpoint.repository.ts";
import { MemoryWebhookDatabase } from "../../repositories/memory/memory.webhook.database.ts";
import {
  WEBHOOK_DELIVERY_PROCESS_NAME,
  type SendBatchPayload,
} from "../../rules/webhook-delivery-contract.rules.ts";
import { WebhookDeliveryRequestService } from "../webhook-delivery-request.service.ts";
import { WebhookEndpointStreamService } from "../webhook-endpoint-stream.service.ts";

const NOW = 1_700_000_000_000;
const ORGANIZATION_ID = "organization-1";
const EVENT_TYPE = "gateway.request.completed";

let endpointCount = 0;
const ids: WebhookId = { newEndpointId: () => `webhook_endpoint_${(endpointCount += 1)}` };
const secrets: WebhookSecret = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
};

function harness({ entitled = true }: { entitled?: boolean } = {}) {
  const processStore = InMemoryProcessStore.createForTesting();
  const endpoints = MemoryWebhookEndpointRepository.create({
    database: MemoryWebhookDatabase.create(),
    options: { ids, secrets },
  });
  const requests = WebhookDeliveryRequestService.create({
    endpoints,
    getPlan: async () => ({ webhookEndpointsEnabled: entitled }),
    stream: WebhookEndpointStreamService.create({ processStore, now: () => NOW }),
    now: () => NOW,
  });
  const addEndpoint = async (enabledEvents: string[] = [EVENT_TYPE]) =>
    (
      await endpoints.create({
        organizationId: ORGANIZATION_ID,
        url: "https://receiver.example.test/hook",
        enabledEvents,
        maxBatchDelayMs: 0,
      })
    ).endpoint;
  const queuedEnvelopes = async (endpointId: string) => {
    const messages = await processStore.findMessagesByRef({
      ref: {
        processName: WEBHOOK_DELIVERY_PROCESS_NAME,
        projectId: ORGANIZATION_ID,
        processKey: `endpoint:${endpointId}`,
      },
    });
    return messages
      .filter((message) => message.intentType === "sendBatch")
      .flatMap((message) => (message.payload as SendBatchPayload).envelopes);
  };
  return { endpoints, requests, addEndpoint, queuedEnvelopes };
}

function request(destinationId: string, idempotencyKey = "alert-1"): WebhookDeliveryRequest {
  return {
    organizationId: ORGANIZATION_ID,
    destinationId,
    message: { type: EVENT_TYPE, idempotencyKey, body: { marker: "content-marker" } },
    source: { module: "governance", ref: "rule-1" },
  };
}

describe("WebhookDeliveryRequestService", () => {
  describe("given an active endpoint subscribed to the message's type", () => {
    describe("when a producer requests delivery of a message to it", () => {
      /** @scenario "A requested delivery answers at once with a stable delivery id" */
      it("answers a delivery id and queues the envelope under that id", async () => {
        const { requests, addEndpoint, queuedEnvelopes } = harness();
        const endpoint = await addEndpoint();

        const { deliveryId } = await requests.requestDelivery(request(endpoint.id));

        expect(deliveryId).toMatch(/^evt_[0-9a-f]{32}$/);
        const queued = await queuedEnvelopes(endpoint.id);
        expect(queued).toEqual([
          {
            id: deliveryId,
            type: EVENT_TYPE,
            created: new Date(NOW).toISOString(),
            schema_version: "1",
            data: { marker: "content-marker" },
          },
        ]);
      });
    });

    describe("when a producer requests delivery twice under one idempotency key", () => {
      /** @scenario "A repeated request under one idempotency key is delivered once" */
      it("answers the same delivery id and queues one envelope", async () => {
        const { requests, addEndpoint, queuedEnvelopes } = harness();
        const endpoint = await addEndpoint();

        const first = await requests.requestDelivery(request(endpoint.id));
        const second = await requests.requestDelivery(request(endpoint.id));

        expect(second.deliveryId).toBe(first.deliveryId);
        expect(await queuedEnvelopes(endpoint.id)).toHaveLength(1);
      });
    });
  });

  describe("given an endpoint that cannot take the message now", () => {
    /** @scenario "A requested delivery an endpoint cannot take now is skipped with a delivery id" */
    it("answers a delivery id and queues nothing when disabled, unsubscribed or unentitled", async () => {
      const disabled = harness();
      const paused = await disabled.addEndpoint();
      await disabled.endpoints.disable({ organizationId: ORGANIZATION_ID, endpointId: paused.id });
      const unsubscribed = harness();
      const elsewhere = await unsubscribed.addEndpoint(["governance.*"]);
      const unentitled = harness({ entitled: false });
      const gated = await unentitled.addEndpoint();

      const cases = [
        { cut: disabled, endpointId: paused.id },
        { cut: unsubscribed, endpointId: elsewhere.id },
        { cut: unentitled, endpointId: gated.id },
      ];
      for (const { cut, endpointId } of cases) {
        const { deliveryId } = await cut.requests.requestDelivery(request(endpointId));
        expect(deliveryId).toMatch(/^evt_[0-9a-f]{32}$/);
        expect(await cut.queuedEnvelopes(endpointId)).toEqual([]);
      }
    });
  });

  describe("given an endpoint id that is unknown or archived", () => {
    /** @scenario "A requested delivery to an unknown or archived endpoint is refused" */
    it("refuses with webhook_endpoint_not_found and queues nothing", async () => {
      const { endpoints, requests, addEndpoint, queuedEnvelopes } = harness();
      const archived = await addEndpoint();
      await endpoints.archive({ organizationId: ORGANIZATION_ID, endpointId: archived.id });

      await expect(
        requests.requestDelivery(request("webhook_endpoint_unknown")),
      ).rejects.toMatchObject({ code: "webhook_endpoint_not_found" });
      await expect(requests.requestDelivery(request(archived.id))).rejects.toMatchObject({
        code: "webhook_endpoint_not_found",
      });
      expect(await queuedEnvelopes(archived.id)).toEqual([]);
    });
  });

  describe("given an unentitled organisation's endpoint migrated with the legacy scheme", () => {
    /** @scenario "A migrated legacy-scheme endpoint keeps delivering without the plan flag" */
    it("queues the envelope although the plan lacks webhook endpoints", async () => {
      const { endpoints, requests, queuedEnvelopes } = harness({ entitled: false });
      const { endpoint } = await endpoints.create({
        organizationId: ORGANIZATION_ID,
        url: "https://receiver.example.test/anomaly",
        enabledEvents: [EVENT_TYPE],
        maxBatchDelayMs: 0,
        signatureScheme: "legacy_sha256",
      });

      await requests.requestDelivery(request(endpoint.id));

      expect(await queuedEnvelopes(endpoint.id)).toHaveLength(1);
    });

    /** @scenario "A migrated endpoint signs with the rule's existing shared secret" */
    it("stores the secret the migration carried as the signing secret", async () => {
      const { endpoints } = harness();
      const { endpoint, secret } = await endpoints.create({
        organizationId: ORGANIZATION_ID,
        url: "https://receiver.example.test/anomaly",
        enabledEvents: [EVENT_TYPE],
        signatureScheme: "legacy_sha256",
        sharedSecret: "rule-shared-secret",
      });

      expect(secret).toBe("rule-shared-secret");
      expect(
        await endpoints.getSigningSecret({
          organizationId: ORGANIZATION_ID,
          endpointId: endpoint.id,
        }),
      ).toBe("rule-shared-secret");
    });
  });
});

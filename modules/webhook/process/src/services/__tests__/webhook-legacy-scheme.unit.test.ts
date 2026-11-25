// SPDX-License-Identifier: Apache-2.0

import { createHmac } from "node:crypto";

import { InMemoryProcessStore, type IntentContext } from "@langwatch/eventing";
import { isValidEventSelector } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import type { WebhookId, WebhookSecret } from "../../app/webhook.app.ts";
import { MemorySqsWebhookDestinationChannel } from "../../channels/memory/memory.sqs-webhook-destination.channel.ts";
import type { HttpWebhookSender } from "../../channels/webhook-destination.channel.ts";
import { MemoryWebhookEndpointRepository } from "../../repositories/memory/memory.webhook-endpoint.repository.ts";
import { MemoryWebhookDatabase } from "../../repositories/memory/memory.webhook.database.ts";
import {
  WEBHOOK_DELIVERY_PROCESS_NAME,
  type SendBatchPayload,
} from "../../rules/webhook-delivery-contract.rules.ts";
import { WEBHOOK_SIGNATURE_HEADER } from "../../rules/webhook-signature.rules.ts";
import { WebhookDeliveryRequestService } from "../webhook-delivery-request.service.ts";
import { WebhookDeliveryService } from "../webhook-delivery.service.ts";
import { WebhookDestinationDispatchService } from "../webhook-destination-dispatch.service.ts";
import { WebhookDispatchCapService } from "../webhook-dispatch-cap.service.ts";
import { WebhookEgressService } from "../webhook-egress.service.ts";
import { WebhookEndpointStreamService } from "../webhook-endpoint-stream.service.ts";

const NOW = 1_700_000_000_000;
const ORGANIZATION_ID = "organization-1";
const ALERT_TYPE = "governance.anomaly_alert.triggered";
const ALERT = {
  ruleId: "rule-1",
  ruleName: "Spend spike",
  alert: { id: "alert-1", triggerSpendUsd: "12.50" },
};

let endpointCount = 0;
const ids: WebhookId = { newEndpointId: () => `webhook_endpoint_${(endpointCount += 1)}` };
const secrets: WebhookSecret = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
};

type Posted = { body: string; headers: Record<string, string> };

async function deliverOneAlert({ legacy }: { legacy: boolean }) {
  const processStore = InMemoryProcessStore.createForTesting();
  const endpoints = MemoryWebhookEndpointRepository.create({
    database: MemoryWebhookDatabase.create(),
    options: { ids, secrets },
  });
  const { endpoint, secret } = await endpoints.create({
    organizationId: ORGANIZATION_ID,
    url: "https://receiver.example.test/hook",
    enabledEvents: [ALERT_TYPE],
    maxBatchDelayMs: 0,
    ...(legacy ? { signatureScheme: "legacy_sha256" as const } : {}),
  });
  await WebhookDeliveryRequestService.create({
    endpoints,
    getPlan: async () => ({ webhookEndpointsEnabled: true }),
    stream: WebhookEndpointStreamService.create({ processStore, now: () => NOW }),
    now: () => NOW,
  }).requestDelivery({
    organizationId: ORGANIZATION_ID,
    destinationId: endpoint.id,
    message: { type: ALERT_TYPE, idempotencyKey: "alert-1", body: ALERT },
    source: { module: "governance", ref: "rule-1" },
  });
  const [batch] = (
    await processStore.findMessagesByRef({
      ref: {
        processName: WEBHOOK_DELIVERY_PROCESS_NAME,
        projectId: ORGANIZATION_ID,
        processKey: `endpoint:${endpoint.id}`,
      },
    })
  ).filter((message) => message.intentType === "sendBatch");

  const posted: Posted[] = [];
  const http: HttpWebhookSender = {
    send: async ({ body, headers }) => {
      posted.push({ body: String(body), headers: headers ?? {} });
      return { status: 200, body: "ok", responseHeaders: {} };
    },
  };
  const egress = WebhookEgressService.create({
    caps: WebhookDispatchCapService.create({
      caps: { countAttempt: async () => ({ allowed: true, remaining: 10, resetAt: NOW }) },
    }),
    http,
    now: () => NOW,
  });
  const context: IntentContext = {
    processName: WEBHOOK_DELIVERY_PROCESS_NAME,
    projectId: ORGANIZATION_ID,
    processKey: `endpoint:${endpoint.id}`,
    tenantId: ORGANIZATION_ID,
    messageKey: batch!.messageKey,
    attempt: 1,
  };
  await WebhookDeliveryService.create({
    processStore,
    endpoints,
    pruneExpiredIdempotencyReceipts: async () => 0,
    getPlan: async () => ({ webhookEndpointsEnabled: true }),
    dispatch: WebhookDeliveryService.dispatchThrough({
      destinations: WebhookDestinationDispatchService.create({
        egress,
        allowInsecureLocal: false,
        sqs: MemorySqsWebhookDestinationChannel.create(),
      }),
    }),
    now: () => NOW,
  }).runWebhookSendBatch()(batch!.payload as SendBatchPayload, context);

  return { endpoint, secret, posted };
}

describe("an endpoint's signature scheme", () => {
  describe("given an endpoint created with the legacy scheme", () => {
    /** @scenario "An endpoint on the legacy scheme receives one raw alert per POST signed sha256=" */
    it("posts the raw alert signed sha256= over the exact body", async () => {
      const { secret, posted } = await deliverOneAlert({ legacy: true });

      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0]!.body)).toEqual(ALERT);
      const expected = createHmac("sha256", secret).update(posted[0]!.body).digest("hex");
      expect(posted[0]!.headers[WEBHOOK_SIGNATURE_HEADER]).toBe(`sha256=${expected}`);
    });

    /** @scenario "An endpoint on the legacy scheme receives one raw alert per POST signed sha256=" */
    it("batches at most one message per POST", async () => {
      const { endpoint } = await deliverOneAlert({ legacy: true });

      expect(endpoint.maxBatchSize).toBe(1);
    });
  });

  describe("when the batch size of an endpoint is raised", () => {
    /** @scenario "Raising the batch size of a legacy-scheme endpoint keeps it at one message per POST" */
    it("keeps a legacy-scheme endpoint at one and lets any other endpoint take the new size", async () => {
      const endpoints = MemoryWebhookEndpointRepository.create({
        database: MemoryWebhookDatabase.create(),
        options: { ids, secrets },
      });
      const create = (legacy: boolean) =>
        endpoints.create({
          organizationId: ORGANIZATION_ID,
          url: "https://receiver.example.test/hook",
          enabledEvents: [ALERT_TYPE],
          ...(legacy ? { signatureScheme: "legacy_sha256" as const } : {}),
        });
      const legacy = await create(true);
      const plain = await create(false);
      const raise = (endpointId: string) =>
        endpoints.update({ organizationId: ORGANIZATION_ID, endpointId, maxBatchSize: 50 });

      expect((await raise(legacy.endpoint.id)).maxBatchSize).toBe(1);
      expect((await raise(plain.endpoint.id)).maxBatchSize).toBe(50);
    });
  });

  describe("given an endpoint created without a scheme", () => {
    /** @scenario "An endpoint without a scheme keeps the batch envelope and the t=,v1= signature" */
    it("posts the batch envelope signed t=,v1=", async () => {
      const { posted } = await deliverOneAlert({ legacy: false });

      expect(posted).toHaveLength(1);
      const body = JSON.parse(posted[0]!.body) as { batch: { type: string; data: unknown }[] };
      expect(body.batch).toEqual([expect.objectContaining({ type: ALERT_TYPE, data: ALERT })]);
      expect(posted[0]!.headers[WEBHOOK_SIGNATURE_HEADER]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    });
  });
});

describe("the webhook event catalog", () => {
  /** @scenario "Governance anomaly alerts are an event type endpoints can subscribe to" */
  it("knows the governance anomaly alert type and its family", () => {
    expect(isValidEventSelector(ALERT_TYPE)).toBe(true);
    expect(isValidEventSelector("governance.*")).toBe(true);
  });
});

/**
 * @vitest-environment node
 * The delivery worker's last hop: the transport an endpoint's configuration names sends it.
 */
import { describe, expect, it } from "vitest";

import { MemorySqsWebhookDestinationChannel } from "../../channels/memory/memory.sqs-webhook-destination.channel.ts";
import { MemoryWebhookDispatchChannel } from "../../channels/memory/memory.webhook-dispatch.channel.ts";
import type { SqsWebhookSender } from "../../channels/webhook-destination.channel.ts";
import type { WebhookDestinationConfig } from "../../rules/webhook-destination.rules.ts";
import { WebhookDeliveryService } from "../webhook-delivery.service.ts";
import { WebhookDestinationDispatchService } from "../webhook-destination-dispatch.service.ts";

const BODY = JSON.stringify({ batch: [{ id: "evt_1", type: "gateway.request.completed" }] });

const queue: WebhookDestinationConfig = {
  kind: "sqs",
  queueUrl: "https://sqs.eu-central-1.amazonaws.com/381491922238/webhooks",
  roleArn: null,
  externalId: null,
  accessKeyId: "AKIA1",
  secretAccessKey: "secret",
};

function request(destination: WebhookDestinationConfig) {
  return {
    destination,
    organizationId: "org_1",
    endpointId: "wh_1",
    body: BODY,
    batchId: "wh_1:abc",
    attempt: 2,
    signingSecrets: ["whsec_test"],
    isTestFire: false,
  };
}

function dispatchWith(sqs: SqsWebhookSender) {
  return WebhookDeliveryService.dispatchThrough({
    destinations: WebhookDestinationDispatchService.create({
      egress: MemoryWebhookDispatchChannel.create(),
      allowInsecureLocal: false,
      sqs,
    }),
  });
}

describe("WebhookDeliveryService.dispatchThrough", () => {
  describe("given a queue endpoint", () => {
    /** @scenario A queue endpoint delivers to its queue through the process's AWS transport */
    it("puts the exact batch body on the queue and answers success with no status", async () => {
      const sqs = MemorySqsWebhookDestinationChannel.create();

      const result = await dispatchWith(sqs)(request(queue));

      expect(result).toMatchObject({ verdict: "success", status: null, dispatchId: "wh_1:abc" });
      expect(sqs.messages()).toHaveLength(1);
      expect(sqs.messages()[0]).toMatchObject({
        body: BODY,
        config: { queueUrl: queue.kind === "sqs" ? queue.queueUrl : "" },
        attributes: {
          "X-LangWatch-Delivery-Attempt": { StringValue: "2" },
          "X-LangWatch-Signature": { DataType: "String" },
        },
      });
    });

    /** @scenario A queue endpoint delivers to its queue through the process's AWS transport */
    it.each([
      ["QueueDoesNotExist", "terminal"],
      ["AccessDenied", "terminal"],
      ["ThrottlingException", "retryable"],
      ["ExpiredToken", "retryable"],
    ] as const)("classifies a %s refusal as %s rather than throwing", async (name, verdict) => {
      const sqs: SqsWebhookSender = {
        send: () => Promise.reject(Object.assign(new Error("refused"), { name })),
        invalidate: () => {},
      };

      await expect(dispatchWith(sqs)(request(queue))).resolves.toMatchObject({
        verdict,
        status: null,
        error: expect.stringContaining("refused"),
      });
    });

    /** @scenario A queue endpoint delivers to its queue through the process's AWS transport */
    it("refuses a batch larger than one message can carry, terminally", async () => {
      const sqs = MemorySqsWebhookDestinationChannel.create();
      const huge = { ...request(queue), body: "x".repeat(262_145) };

      await expect(dispatchWith(sqs)(huge)).resolves.toMatchObject({ verdict: "terminal" });
      expect(sqs.messages()).toHaveLength(0);
    });
  });

  describe("given an HTTPS endpoint", () => {
    /** @scenario A queue endpoint delivers to its queue through the process's AWS transport */
    it("still sends through the egress and never touches the queue", async () => {
      const sqs = MemorySqsWebhookDestinationChannel.create();
      const egress = MemoryWebhookDispatchChannel.create();
      const dispatch = WebhookDeliveryService.dispatchThrough({
        destinations: WebhookDestinationDispatchService.create({
          egress,
          allowInsecureLocal: false,
          sqs,
        }),
      });

      const result = await dispatch(request({ kind: "http", url: "https://example.com/hook" }));

      expect(result).toMatchObject({ verdict: "success", status: 200 });
      expect(egress.sent).toMatchObject([{ url: "https://example.com/hook", body: BODY }]);
      expect(sqs.messages()).toHaveLength(0);
    });
  });
});

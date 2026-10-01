import { describe, expect, it } from "vitest";

import { MemorySqsWebhookDestinationChannel } from "../memory.sqs-webhook-destination.channel.ts";

const QUEUE_URL = "https://sqs.eu-central-1.amazonaws.com/381491922238/webhooks";

describe("MemorySqsWebhookDestinationChannel", () => {
  describe("when a destination adapter sends a queue message", () => {
    it("records the destination bytes and attributes under a stable memory message id", async () => {
      const channel = MemorySqsWebhookDestinationChannel.create();
      const message = {
        config: { queueUrl: QUEUE_URL, accessKeyId: "AKIA1", secretAccessKey: "secret" },
        body: '{"batch":[{"id":"evt_1"}]}',
        attributes: {
          "X-LangWatch-Delivery-Id": { DataType: "String", StringValue: "batch-1" },
        },
      };

      await expect(channel.send(message)).resolves.toBe("memory-sqs-1");
      channel.invalidate(QUEUE_URL);

      expect(channel.messages()).toEqual([message]);
    });
  });
});

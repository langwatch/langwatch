import type { WebhookSendRequest } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { HttpWebhookDeliveryChannel } from "../http.webhook-delivery.channel.ts";

const request = {
  projectId: "proj_1",
  triggerId: "trg_1",
  eventId: "evt_abc",
  url: "https://example.com/hook",
  method: "POST" as const,
  headers: { "X-Trace": "t1" },
  body: "fired",
  contentType: "text/plain; charset=utf-8",
  triggerName: "My automation",
};

/** Recording, classification and the ledger belong to webhook (webhook-request.service tests). */
describe("HttpWebhookDeliveryChannel.deliver", () => {
  describe("when an automation hands over an attempt", () => {
    it("names its trigger as the source and carries the body's type", async () => {
      const sent: WebhookSendRequest[] = [];
      const channel = HttpWebhookDeliveryChannel.create({
        sendRequest: async (input) => {
          sent.push(input);
          return { status: 200, dispatchId: input.dispatchId };
        },
      });

      const result = await channel.deliver(request);

      expect(result).toEqual({ status: 200, dispatchId: "evt_abc" });
      expect(sent).toEqual([
        expect.objectContaining({
          projectId: "proj_1",
          dispatchId: "evt_abc",
          body: "fired",
          contentType: "text/plain; charset=utf-8",
          label: 'Webhook for trigger "My automation"',
          source: { module: "automation", ref: "trg_1" },
        }),
      ]);
    });
  });
});

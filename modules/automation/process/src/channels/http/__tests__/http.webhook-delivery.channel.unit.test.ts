import type { WebhookDeliveryInput } from "@langwatch/automation-contract";
import { assertWebhookDelivered } from "@langwatch/egress";
import { DispatchError } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import {
  HttpWebhookDeliveryChannel,
  type WebhookSendResult,
} from "../http.webhook-delivery.channel.ts";

const request = {
  projectId: "proj_1",
  triggerId: "trg_1",
  eventId: "evt_abc",
  url: "https://example.com/hook",
  method: "POST" as const,
  headers: { Authorization: "Bearer secret", "X-Trace": "t1" },
  body: "{}",
  triggerName: "My automation",
};

/** The real classification of a status, over a transport that answers what it is told. */
function channelAnswering(overrides: Partial<WebhookSendResult>) {
  return HttpWebhookDeliveryChannel.create({
    send: async () => ({ status: 200, body: "ok", eventId: "evt_abc", ...overrides }),
    assertDelivered: assertWebhookDelivered,
  });
}

function channelRefusing(error: DispatchError) {
  return HttpWebhookDeliveryChannel.create({
    send: () => Promise.reject(error),
    assertDelivered: assertWebhookDelivered,
  });
}

function recording() {
  const rows: WebhookDeliveryInput[] = [];
  return { rows, recorder: async (row: WebhookDeliveryInput) => void rows.push(row) };
}

describe("HttpWebhookDeliveryChannel.deliver", () => {
  describe("when the endpoint answers 2xx", () => {
    /** @scenario "Each attempt is recorded with its outcome" */
    it("records a success row with the event id as dispatch id", async () => {
      const { rows, recorder } = recording();

      await channelAnswering({ status: 201 }).deliver({ ...request, recorder });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        projectId: "proj_1",
        triggerId: "trg_1",
        dispatchId: "evt_abc",
        responseStatus: 201,
        outcome: "success",
      });
      expect(rows[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    });

    /** @scenario "The delivery log never stores request content" */
    it("stores no request content: URL, headers and body never persist", async () => {
      const { rows, recorder } = recording();

      await channelAnswering({ status: 200, body: "receiver says hi" }).deliver({
        ...request,
        recorder,
      });

      const stored = JSON.stringify(rows[0]);
      for (const content of [
        "example.com",
        "Authorization",
        "Bearer secret",
        "t1",
        "receiver says hi",
      ]) {
        expect(stored).not.toContain(content);
      }
    });
  });

  describe("when the endpoint answers a retryable status", () => {
    it("records a retryable row and rethrows", async () => {
      const { rows, recorder } = recording();

      await expect(
        channelAnswering({ status: 503, body: "down" }).deliver({ ...request, recorder }),
      ).rejects.toBeInstanceOf(DispatchError);

      expect(rows[0]).toMatchObject({ responseStatus: 503, outcome: "retryable" });
      expect(rows[0]?.error).toContain("503");
      expect(JSON.stringify(rows[0])).not.toContain("Bearer secret");
    });
  });

  describe("when the endpoint answers a terminal status", () => {
    it("records a terminal row that keeps the receiver's response", async () => {
      const { rows, recorder } = recording();

      await expect(
        channelAnswering({ status: 404, body: "gone" }).deliver({ ...request, recorder }),
      ).rejects.toBeInstanceOf(DispatchError);

      expect(rows[0]).toMatchObject({ responseStatus: 404, outcome: "terminal" });
      expect(rows[0]?.response?.body).toBe("gone");
    });
  });

  describe("when the sender throws before the endpoint answers", () => {
    /** @scenario "An attempt that never reached the endpoint is recorded too" */
    it("records the error and the latency but no status", async () => {
      const { rows, recorder } = recording();
      const blocked = new DispatchError({
        message: "blocked: private address",
        retryable: false,
      });

      await expect(channelRefusing(blocked).deliver({ ...request, recorder })).rejects.toBe(
        blocked,
      );

      expect(rows[0]).toMatchObject({
        responseStatus: null,
        error: "blocked: private address",
        response: null,
        outcome: "terminal",
      });
      expect(rows[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("when the recorder itself throws", () => {
    it("does not break dispatch", async () => {
      const result = await channelAnswering({ status: 200 }).deliver({
        ...request,
        recorder: vi.fn(async () => {
          throw new Error("db down");
        }),
      });

      expect(result.status).toBe(200);
    });
  });

  describe("when no recorder is supplied", () => {
    it("still delivers", async () => {
      const result = await channelAnswering({ status: 200 }).deliver(request);

      expect(result.status).toBe(200);
    });
  });
});

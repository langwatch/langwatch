import { describe, expect, it, vi } from "vitest";
import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import type { WebhookDeliveryInput } from "~/server/app-layer/triggers/repositories/webhook-delivery.repository";
import { deliverWebhook } from "../deliverWebhook";
import type { sendWebhook, WebhookSendResult } from "../sendWebhook";

const base = {
  projectId: "proj_1",
  triggerId: "trg_1",
  eventId: "evt_abc",
  url: "https://example.com/hook",
  method: "POST" as const,
  // A heuristic-named credential, a heuristic-miss credential, and a
  // non-secret trace header — EVERY value must be masked in the log.
  headers: {
    Authorization: "Bearer secret",
    "X-Partner-Key": "pk_live_123",
    "X-Trace": "t1",
  },
  body: "{}",
  triggerName: "My automation",
};

function sendResolvingWith(
  overrides: Partial<WebhookSendResult>,
): typeof sendWebhook {
  return (async () => ({
    status: 200,
    body: "ok",
    eventId: "evt_abc",
    ...overrides,
  })) as unknown as typeof sendWebhook;
}

describe("deliverWebhook", () => {
  describe("when the endpoint answers 2xx", () => {
    it("records a success row with redacted headers and the eventId as dispatchId", async () => {
      const rows: WebhookDeliveryInput[] = [];
      await deliverWebhook({
        ...base,
        send: sendResolvingWith({ status: 201 }),
        recorder: async (row) => {
          rows.push(row);
        },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        projectId: "proj_1",
        triggerId: "trg_1",
        dispatchId: "evt_abc",
        requestMethod: "POST",
        requestUrl: "https://example.com/hook",
        responseStatus: 201,
        outcome: "success",
      });
      expect(rows[0]!.requestHeaders).toEqual({
        Authorization: "***",
        "X-Partner-Key": "***",
        "X-Trace": "***",
      });
      expect(rows[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("stores the request URL as origin + path only, stripping the query", async () => {
      const rows: WebhookDeliveryInput[] = [];
      await deliverWebhook({
        ...base,
        url: "https://example.com/hook?token=secret&sig=abc#frag",
        send: sendResolvingWith({ status: 200 }),
        recorder: async (row) => {
          rows.push(row);
        },
      });
      expect(rows[0]!.requestUrl).toBe("https://example.com/hook");
    });
  });

  describe("when the endpoint answers a retryable status", () => {
    it("records a retryable row and re-throws", async () => {
      const rows: WebhookDeliveryInput[] = [];
      await expect(
        deliverWebhook({
          ...base,
          send: sendResolvingWith({ status: 503, body: "down" }),
          recorder: async (row) => {
            rows.push(row);
          },
        }),
      ).rejects.toBeInstanceOf(DispatchError);
      expect(rows[0]).toMatchObject({
        responseStatus: 503,
        outcome: "retryable",
      });
    });
  });

  describe("when the endpoint answers a terminal status", () => {
    it("records a terminal row and re-throws", async () => {
      const rows: WebhookDeliveryInput[] = [];
      await expect(
        deliverWebhook({
          ...base,
          send: sendResolvingWith({ status: 404, body: "gone" }),
          recorder: async (row) => {
            rows.push(row);
          },
        }),
      ).rejects.toBeInstanceOf(DispatchError);
      expect(rows[0]).toMatchObject({ responseStatus: 404, outcome: "terminal" });
    });
  });

  describe("when the sender throws before responding", () => {
    it("records a row with the error message and no status", async () => {
      const rows: WebhookDeliveryInput[] = [];
      const send = (async () => {
        throw new DispatchError({
          message: "blocked: private address",
          retryable: false,
        });
      }) as unknown as typeof sendWebhook;
      await expect(
        deliverWebhook({
          ...base,
          send,
          recorder: async (row) => {
            rows.push(row);
          },
        }),
      ).rejects.toBeInstanceOf(DispatchError);
      expect(rows[0]).toMatchObject({
        responseStatus: null,
        error: "blocked: private address",
        outcome: "terminal",
      });
    });
  });

  describe("when the recorder itself throws", () => {
    it("does not break dispatch (logging is best-effort)", async () => {
      const result = await deliverWebhook({
        ...base,
        send: sendResolvingWith({ status: 200 }),
        recorder: vi.fn(async () => {
          throw new Error("db down");
        }),
      });
      expect(result.status).toBe(200);
    });
  });

  describe("when no recorder is supplied", () => {
    it("still delivers", async () => {
      const result = await deliverWebhook({
        ...base,
        send: sendResolvingWith({ status: 200 }),
      });
      expect(result.status).toBe(200);
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import type { WebhookDeliveryInput } from "~/server/app-layer/automations/repositories/webhook-delivery.repository";
import { decrypt } from "~/utils/encryption";
import {
  deliverWebhook,
  type WebhookFailureResponse,
} from "../deliverWebhook";
import type { sendWebhook, WebhookSendResult } from "../sendWebhook";

const base = {
  projectId: "proj_1",
  triggerId: "trg_1",
  eventId: "evt_abc",
  url: "https://example.com/hook",
  method: "POST" as const,
  headers: { Authorization: "Bearer secret", "X-Trace": "t1" },
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
    it("records a success row with the eventId as dispatchId", async () => {
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
        responseStatus: 201,
        outcome: "success",
      });
      expect(rows[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("stores no request content — URL, headers, and body never persist", async () => {
      const rows: WebhookDeliveryInput[] = [];
      await deliverWebhook({
        ...base,
        send: sendResolvingWith({ status: 200, body: "receiver says hi" }),
        recorder: async (row) => {
          rows.push(row);
        },
      });
      const serialized = JSON.stringify(rows[0]);
      expect(serialized).not.toContain("example.com");
      expect(serialized).not.toContain("Authorization");
      expect(serialized).not.toContain("Bearer secret");
      expect(serialized).not.toContain("t1");
      expect(serialized).not.toContain("receiver says hi");
    });
  });

  describe("when the endpoint answers a retryable status", () => {
    it("records a classified retryable row and re-throws", async () => {
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
      // The capped classified message is kept — it may quote the RECEIVER's
      // error body (their fault if they echo secrets); our own request
      // content never appears in it.
      expect(rows[0]!.error).toContain("HTTP 503");
      expect(JSON.stringify(rows[0])).not.toContain("Bearer secret");
    });

    it("scrubs our configured header values when the receiver echoes them", async () => {
      const rows: WebhookDeliveryInput[] = [];
      await expect(
        deliverWebhook({
          ...base,
          send: sendResolvingWith({
            status: 500,
            body: 'auth failed for "Bearer secret"',
            responseHeaders: { "x-echo": "Bearer secret" },
          }),
          recorder: async (row) => {
            rows.push(row);
          },
        }),
      ).rejects.toBeInstanceOf(DispatchError);
      expect(rows[0]!.error).toContain("***");
      expect(JSON.stringify(rows[0])).not.toContain("Bearer secret");
      // Scrubbed inside the encrypted response too — body AND headers.
      const response = JSON.parse(
        decrypt(rows[0]!.responseEncrypted!),
      ) as WebhookFailureResponse;
      expect(response.body).toContain("***");
      expect(response.headers).toEqual({ "x-echo": "***" });
    });
  });

  describe("when the endpoint answers a terminal status", () => {
    it("records a classified terminal row and re-throws", async () => {
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
      expect(rows[0]).toMatchObject({
        responseStatus: 404,
        outcome: "terminal",
      });
      // The receiver's truncated response is kept encrypted for debugging.
      const response = JSON.parse(
        decrypt(rows[0]!.responseEncrypted!),
      ) as WebhookFailureResponse;
      expect(response.body).toBe("gone");
    });
  });

  describe("when the sender throws before responding", () => {
    it("records a classified row with the error message and no status", async () => {
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
        responseEncrypted: null,
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

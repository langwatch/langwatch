import { describe, expect, it, vi } from "vitest";
import { DispatchError } from "@langwatch/dispatch-error";
import { assertWebhookDelivered, createWebhookSender } from "../webhook.client";

// Pre-egress failure paths only — none of these ports is ever reached.
const { sendWebhook } = createWebhookSender({
  egress: { safeFetch: vi.fn(), fetchWithResolvedIp: vi.fn() },
  rateLimit: vi.fn(async () => ({ allowed: true, resetAt: 0 })),
  validateWebhookUrl: vi.fn(async () => ({})),
});

async function captureDispatchError(
  fn: () => Promise<unknown>,
): Promise<DispatchError> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DispatchError);
    return err as DispatchError;
  }
  throw new Error("expected the call to throw");
}

describe("sendWebhook", () => {
  describe("when the URL fails the shape check", () => {
    it("rejects http URLs terminally without any network call", async () => {
      const err = await captureDispatchError(() =>
        sendWebhook({
          url: "http://example.com/hook",
          body: "{}",
          triggerName: "My automation",
        }),
      );
      expect(err.retryable).toBe(false);
      expect(err.message).toContain("https");
    });

    it("rejects non-default ports terminally", async () => {
      const err = await captureDispatchError(() =>
        sendWebhook({
          url: "https://example.com:8443/hook",
          body: "{}",
          triggerName: "My automation",
        }),
      );
      expect(err.retryable).toBe(false);
      expect(err.message).toContain("port");
    });
  });

  describe("when the URL points at a private or loopback address", () => {
    // Executed SSRF regression (ADR-040 §4): the strict validator blocks
    // local addresses regardless of the BLOCK_LOCAL_HTTP_CALLS toggle, and
    // the block is observed on the real code path — no string assertions on
    // generated config.
    it.each([
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.1/hook",
      "https://169.254.169.254/hook",
      "https://[::1]/hook",
    ])("blocks %s terminally before any connection", async (url) => {
      const err = await captureDispatchError(() =>
        sendWebhook({ url, body: "{}", triggerName: "My automation" }),
      );
      expect(err.retryable).toBe(false);
    });
  });
});

describe("assertWebhookDelivered", () => {
  const triggerName = "My automation";

  describe("when the endpoint answers 2xx", () => {
    it("returns without throwing", () => {
      expect(() =>
        assertWebhookDelivered({
          result: { status: 200, body: "ok" },
          triggerName,
        }),
      ).not.toThrow();
      expect(() =>
        assertWebhookDelivered({
          result: { status: 204, body: "" },
          triggerName,
        }),
      ).not.toThrow();
    });
  });

  describe("when the endpoint answers a retryable status", () => {
    it.each([500, 502, 503, 429, 408])("classifies %s as retryable", (status) => {
      try {
        assertWebhookDelivered({ result: { status, body: "" }, triggerName });
        throw new Error("expected a throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DispatchError);
        expect((err as DispatchError).retryable).toBe(true);
      }
    });
  });

  describe("when the endpoint answers a terminal status", () => {
    it.each([301, 400, 401, 403, 404, 422])(
      "classifies %s as terminal",
      (status) => {
        try {
          assertWebhookDelivered({ result: { status, body: "" }, triggerName });
          throw new Error("expected a throw");
        } catch (err) {
          expect(err).toBeInstanceOf(DispatchError);
          expect((err as DispatchError).retryable).toBe(false);
        }
      },
    );

    it("carries a capped response snippet in the message", () => {
      try {
        assertWebhookDelivered({
          result: { status: 422, body: `{"error":"bad schema"}` },
          triggerName,
        });
        throw new Error("expected a throw");
      } catch (err) {
        expect((err as DispatchError).message).toContain("HTTP 422");
        expect((err as DispatchError).message).toContain("bad schema");
      }
    });
  });
});

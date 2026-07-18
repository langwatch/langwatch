import { afterEach, describe, expect, it, vi } from "vitest";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";

// Stub the SSRF-fenced transport and the rate limiter so these tests exercise
// sendWebhook's ORCHESTRATION (event-id header, dispatch cap, Retry-After
// threading) without a network call. The executed SSRF blocks live in
// sendWebhook.unit.test.ts, which uses the real transport.
vi.mock("../httpDestination", () => ({ sendHttpDestination: vi.fn() }));
vi.mock("~/server/rateLimit", () => ({ rateLimit: vi.fn() }));

import { rateLimit } from "~/server/rateLimit";
import { sendHttpDestination } from "../httpDestination";
import {
  assertWebhookDelivered,
  sendWebhook,
  WEBHOOK_DISPATCH_HOURLY_CAP,
} from "../sendWebhook";

const mockedSend = vi.mocked(sendHttpDestination);
const mockedRateLimit = vi.mocked(rateLimit);

function sendResolves(overrides?: { status?: number; retryAfterMs?: number }) {
  mockedSend.mockResolvedValue({
    status: overrides?.status ?? 200,
    body: "ok",
    retryAfterMs: overrides?.retryAfterMs,
  });
}

function allowRateLimit() {
  mockedRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 10,
    resetAt: Date.now() + 3600_000,
  });
}

afterEach(() => vi.clearAllMocks());

const base = {
  url: "https://example.com/hook",
  body: "{}",
  triggerName: "My automation",
};

describe("sendWebhook dispatch orchestration", () => {
  describe("when a stable eventId is supplied", () => {
    it("sends it as X-LangWatch-Event-Id and echoes it in the result", async () => {
      sendResolves();
      allowRateLimit();
      const result = await sendWebhook({
        ...base,
        projectId: "proj_1",
        eventId: "evt_stable",
      });
      const headers = mockedSend.mock.calls[0]![0].headers as Record<
        string,
        string
      >;
      expect(headers["X-LangWatch-Event-Id"]).toBe("evt_stable");
      expect(result.eventId).toBe("evt_stable");
    });
  });

  describe("when no eventId is supplied", () => {
    it("generates a fresh one so the header is always present", async () => {
      sendResolves();
      const result = await sendWebhook({ ...base, testFire: true });
      const headers = mockedSend.mock.calls[0]![0].headers as Record<
        string,
        string
      >;
      expect(headers["X-LangWatch-Event-Id"]).toBe(result.eventId);
      expect(result.eventId).toMatch(/[0-9a-f-]{36}/);
    });
  });

  describe("the per-project dispatch cap", () => {
    it("gates a real dispatch on the project cap", async () => {
      sendResolves();
      allowRateLimit();
      await sendWebhook({ ...base, projectId: "proj_1" });
      expect(mockedRateLimit).toHaveBeenCalledWith({
        key: "webhook-dispatch:proj_1",
        windowSeconds: 3600,
        max: WEBHOOK_DISPATCH_HOURLY_CAP,
      });
    });

    it("does NOT rate-limit a test fire", async () => {
      sendResolves();
      await sendWebhook({ ...base, projectId: "proj_1", testFire: true });
      expect(mockedRateLimit).not.toHaveBeenCalled();
    });

    it("throws retryable with a Retry-After when the cap is exceeded", async () => {
      const resetAt = Date.now() + 120_000;
      mockedRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt,
      });
      let caught: unknown;
      try {
        await sendWebhook({ ...base, projectId: "proj_1" });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(DispatchError);
      expect((caught as DispatchError).retryable).toBe(true);
      expect((caught as DispatchError).retryAfterMs).toBeGreaterThan(0);
      // The endpoint was never contacted.
      expect(mockedSend).not.toHaveBeenCalled();
    });
  });

  describe("Retry-After from the receiver", () => {
    it("threads it onto the retryable DispatchError on a 429", () => {
      let caught: unknown;
      try {
        assertWebhookDelivered({
          result: { status: 429, body: "slow down", retryAfterMs: 90_000 },
          triggerName: "My automation",
        });
      } catch (err) {
        caught = err;
      }
      expect((caught as DispatchError).retryable).toBe(true);
      expect((caught as DispatchError).retryAfterMs).toBe(90_000);
    });

    it("does not carry a Retry-After onto a terminal 4xx", () => {
      let caught: unknown;
      try {
        assertWebhookDelivered({
          result: { status: 400, body: "bad", retryAfterMs: 90_000 },
          triggerName: "My automation",
        });
      } catch (err) {
        caught = err;
      }
      expect((caught as DispatchError).retryable).toBe(false);
      expect((caught as DispatchError).retryAfterMs).toBeUndefined();
    });
  });
});

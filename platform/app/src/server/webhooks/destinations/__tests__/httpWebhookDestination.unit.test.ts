import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SSRF-fenced HTTP utility and the rate limiter are the boundaries; the
// classification under test is the real one.
vi.mock("../../httpDestination", () => ({ sendHttpDestination: vi.fn() }));
vi.mock("~/server/rateLimit", () => ({ rateLimit: vi.fn() }));

import { rateLimit } from "~/server/rateLimit";
import { sendHttpDestination } from "../../httpDestination";
import { httpWebhookDestination } from "../httpWebhookDestination";
import type { WebhookDispatchRequest } from "../types";

const mockedSend = vi.mocked(sendHttpDestination);
const mockedRateLimit = vi.mocked(rateLimit);

const URL_UNDER_TEST = "https://receiver.example.com/webhooks/langwatch";

function request(
  overrides: Partial<WebhookDispatchRequest> = {},
): WebhookDispatchRequest {
  return {
    organizationId: "org_1",
    endpointId: "wh_1",
    body: JSON.stringify({ batch: [] }),
    batchId: "wh_1:abc123",
    attempt: 1,
    signingSecrets: ["whsec_test"],
    ...overrides,
  };
}

function receiverAnswers(status: number, retryAfterMs?: number) {
  mockedSend.mockResolvedValue({
    status,
    body: "ok",
    responseHeaders: {},
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  } as never);
}

describe("httpWebhookDestination", () => {
  beforeEach(() => {
    mockedRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 999,
      resetAt: Date.now() + 3_600_000,
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("given a receiver answer", () => {
    /** @scenario The HTTP transport classifies exactly as the sender always did */
    it("treats every 2xx as success", async () => {
      for (const status of [200, 201, 202, 204, 299]) {
        receiverAnswers(status);
        const result = await httpWebhookDestination({
          url: URL_UNDER_TEST,
        }).send(request());
        expect(result.verdict).toBe("success");
      }
    });

    /** @scenario The HTTP transport classifies exactly as the sender always did */
    it("retries 500, 429 and 408", async () => {
      for (const status of [500, 502, 503, 429, 408]) {
        receiverAnswers(status);
        const result = await httpWebhookDestination({
          url: URL_UNDER_TEST,
        }).send(request());
        expect(result.verdict).toBe("retryable");
      }
    });

    /** @scenario The HTTP transport classifies exactly as the sender always did */
    it("retires every other status, redirects included", async () => {
      for (const status of [301, 302, 307, 400, 401, 403, 404, 410, 422]) {
        receiverAnswers(status);
        const result = await httpWebhookDestination({
          url: URL_UNDER_TEST,
        }).send(request());
        expect(result.verdict).toBe("terminal");
      }
    });

    /** @scenario The transport answers with a verdict, not a status */
    it("reports the receiver's status alongside the verdict", async () => {
      receiverAnswers(503, 5_000);
      const result = await httpWebhookDestination({ url: URL_UNDER_TEST }).send(
        request(),
      );
      expect(result).toMatchObject({
        verdict: "retryable",
        status: 503,
        retryAfterMs: 5_000,
        error: "HTTP 503",
      });
    });
  });

  describe("when the organization is at its hourly dispatch cap", () => {
    /** @scenario Both destinations answer to the same hourly dispatch cap */
    it("backs off before reaching the receiver", async () => {
      mockedRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
      } as never);

      await expect(
        httpWebhookDestination({ url: URL_UNDER_TEST }).send(request()),
      ).rejects.toMatchObject({ retryable: true });
      expect(mockedSend).not.toHaveBeenCalled();
      expect(mockedRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({ key: "webhook-dispatch:org_1" }),
      );
    });

    it("exempts a test fire", async () => {
      mockedRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 60_000,
      } as never);
      receiverAnswers(200);

      const result = await httpWebhookDestination({ url: URL_UNDER_TEST }).send(
        request({ testFire: true }),
      );

      expect(result.verdict).toBe("success");
      expect(mockedRateLimit).not.toHaveBeenCalled();
      expect(mockedSend).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ "X-LangWatch-Test-Fire": "true" }),
        }),
      );
    });
  });
});

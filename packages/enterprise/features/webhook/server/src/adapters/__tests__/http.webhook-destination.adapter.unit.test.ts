import { afterEach, describe, expect, it, vi } from "vitest";
import { DispatchError } from "@langwatch/eventing";
import type { WebhookEgressService } from "@langwatch/egress";
import { httpWebhookDestination } from "../http.webhook-destination.adapter";
import type { WebhookDispatchRequest } from "../../ports/webhook-destination.port";

// The SSRF-fenced egress service (which also owns the hourly dispatch cap) is
// the boundary; the classification under test is the real one.
const mockedSend = vi.fn<WebhookEgressService["send"]>();
const egress = { send: mockedSend } as unknown as WebhookEgressService;

const URL_UNDER_TEST = "https://receiver.example.com/webhooks/langwatch";

const destination = () =>
  httpWebhookDestination({ url: URL_UNDER_TEST, egress, allowInsecureLocal: false });

function request(overrides: Partial<WebhookDispatchRequest> = {}): WebhookDispatchRequest {
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
    eventId: "wh_1:abc123",
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  } as never);
}

describe("httpWebhookDestination", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("given a receiver answer", () => {
    /** @scenario An HTTPS endpoint keeps the retry rules it always had */
    it("treats every 2xx as success", async () => {
      for (const status of [200, 201, 202, 204, 299]) {
        receiverAnswers(status);
        const result = await destination().send(request());
        expect(result.verdict).toBe("success");
      }
    });

    /** @scenario An HTTPS endpoint keeps the retry rules it always had */
    it("retries 500, 429 and 408", async () => {
      for (const status of [500, 502, 503, 429, 408]) {
        receiverAnswers(status);
        const result = await destination().send(request());
        expect(result.verdict).toBe("retryable");
      }
    });

    /** @scenario An HTTPS endpoint keeps the retry rules it always had */
    it("marks every other status terminal, redirects included", async () => {
      for (const status of [301, 302, 307, 400, 401, 403, 404, 410, 422]) {
        receiverAnswers(status);
        const result = await destination().send(request());
        expect(result.verdict).toBe("terminal");
      }
    });

    /** @scenario An HTTPS endpoint keeps the retry rules it always had */
    it("reports the receiver's status alongside the verdict", async () => {
      receiverAnswers(503, 5_000);
      const result = await destination().send(request());
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
    it("backs off before reaching the receiver, counted against the organization", async () => {
      mockedSend.mockRejectedValue(
        new DispatchError({ message: "cap reached", retryable: true, retryAfterMs: 60_000 }),
      );

      await expect(destination().send(request())).rejects.toMatchObject({ retryable: true });
      // The cap buckets per organization, so that is the scope the sender is
      // handed to count under.
      expect(mockedSend).toHaveBeenCalledWith(expect.objectContaining({ projectId: "org_1" }));
    });

    it("exempts a test fire", async () => {
      receiverAnswers(200);

      const result = await destination().send(request({ isTestFire: true }));

      expect(result.verdict).toBe("success");
      expect(mockedSend).toHaveBeenCalledWith(expect.objectContaining({ testFire: true }));
      expect(mockedSend).not.toHaveBeenCalledWith(expect.objectContaining({ projectId: "org_1" }));
    });
  });
});

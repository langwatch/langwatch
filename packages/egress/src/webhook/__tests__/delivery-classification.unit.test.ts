import { DispatchError } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import { assertWebhookDelivered, classifyWebhookStatus } from "../delivery-classification";

/**
 * Spec: packages/egress/specs/webhook-egress.feature
 *
 * What a status means, as a table. The queue reads this verdict and nothing
 * else: a status misread as retryable re-sends a dead payload until it
 * dead-letters, and one misread as terminal drops a delivery the receiver was
 * only briefly unable to take.
 */

const capture = (fn: () => void): DispatchError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof DispatchError) return error;
    throw error;
  }
  throw new Error("expected the assertion to throw");
};

describe("classifyWebhookStatus", () => {
  describe("given the receiver's answer", () => {
    /** @scenario "Server errors retry, everything else that is not success is terminal" */
    it.each([
      [200, "success"],
      [201, "success"],
      [204, "success"],
      [299, "success"],
      [408, "retryable"],
      [429, "retryable"],
      [500, "retryable"],
      [502, "retryable"],
      [503, "retryable"],
      [301, "terminal"],
      [304, "terminal"],
      [400, "terminal"],
      [401, "terminal"],
      [403, "terminal"],
      [404, "terminal"],
      [422, "terminal"],
    ])("classifies %i as %s", (status, verdict) => {
      expect(classifyWebhookStatus(status)).toBe(verdict);
    });
  });
});

describe("assertWebhookDelivered", () => {
  describe("given a successful answer", () => {
    /** @scenario "Server errors retry, everything else that is not success is terminal" */
    it("returns without throwing", () => {
      expect(() =>
        assertWebhookDelivered({
          result: { status: 200, body: "ok" },
          triggerName: "My automation",
        }),
      ).not.toThrow();
    });
  });

  describe("given a retryable answer", () => {
    /** @scenario "Server errors retry, everything else that is not success is terminal" */
    it("carries the receiver's own back-off onto the failure", () => {
      const error = capture(() =>
        assertWebhookDelivered({
          result: { status: 429, body: "slow down", retryAfterMs: 90_000 },
          triggerName: "My automation",
        }),
      );

      expect(error.retryable).toBe(true);
      expect(error.retryAfterMs).toBe(90_000);
    });
  });

  describe("given a terminal answer", () => {
    /** @scenario "Server errors retry, everything else that is not success is terminal" */
    it("drops the back-off, because there is no next attempt to space out", () => {
      const error = capture(() =>
        assertWebhookDelivered({
          result: { status: 400, body: "bad", retryAfterMs: 90_000 },
          triggerName: "My automation",
        }),
      );

      expect(error.retryable).toBe(false);
      expect(error.retryAfterMs).toBeUndefined();
    });

    /** @scenario "Server errors retry, everything else that is not success is terminal" */
    it("quotes a capped snippet of what the receiver said, and names the automation", () => {
      const error = capture(() =>
        assertWebhookDelivered({
          result: { status: 422, body: `{"error":"bad schema"}${"!".repeat(600)}` },
          triggerName: "My automation",
        }),
      );

      expect(error.message).toContain('Webhook for trigger "My automation" received HTTP 422');
      expect(error.message).toContain("bad schema");
      expect(error.message.length).toBeLessThan(400);
    });
  });
});

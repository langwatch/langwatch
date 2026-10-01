import { describe, expect, it } from "vitest";

import {
  classifyWebhookStatus,
  judgeWebhookDelivery,
} from "../webhook-delivery-classification.rules.ts";

/**
 * Spec: modules/webhook/specs/webhook-egress.feature
 * What a status means, as a table: misreading retryable re-sends a dead
 * payload till it dead-letters; misreading terminal drops a briefly-down delivery.
 */

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

describe("judgeWebhookDelivery", () => {
  const label = 'Webhook for trigger "My automation"';

  describe("given a successful answer", () => {
    /** @scenario "Server errors retry, everything else that is not success is terminal" */
    it("is delivered", () => {
      expect(judgeWebhookDelivery({ result: { status: 200, body: "ok" }, label })).toEqual({
        delivered: true,
      });
    });
  });

  describe("given a retryable answer", () => {
    /** @scenario "Server errors retry, everything else that is not success is terminal" */
    it("carries the receiver's own back-off onto the refusal", () => {
      expect(
        judgeWebhookDelivery({
          result: { status: 429, body: "slow down", retryAfterMs: 90_000 },
          label,
        }),
      ).toMatchObject({ delivered: false, retryable: true, retryAfterMs: 90_000 });
    });
  });

  describe("given a terminal answer", () => {
    /** @scenario "Server errors retry, everything else that is not success is terminal" */
    it("drops the back-off, because there is no next attempt to space out", () => {
      expect(
        judgeWebhookDelivery({
          result: { status: 400, body: "bad", retryAfterMs: 90_000 },
          label,
        }),
      ).toMatchObject({ delivered: false, retryable: false, retryAfterMs: undefined });
    });

    /** @scenario "Server errors retry, everything else that is not success is terminal" */
    it("quotes a capped snippet of what the receiver said, and names the automation", () => {
      const verdict = judgeWebhookDelivery({
        result: { status: 422, body: `{"error":"bad schema"}${"!".repeat(600)}` },
        label,
      });

      expect(verdict).toMatchObject({ delivered: false });
      const message = verdict.delivered ? "" : verdict.message;
      expect(message).toContain('Webhook for trigger "My automation" received HTTP 422');
      expect(message).toContain("bad schema");
      expect(message.length).toBeLessThan(400);
    });
  });
});

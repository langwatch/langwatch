import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../httpDestination", () => ({ sendHttpDestination: vi.fn() }));
vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, resetAt: 0 })),
}));

import { sendHttpDestination } from "../httpDestination";
import { sendWebhook } from "../sendWebhook";
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from "../signature";

/**
 * The wire contract of opt-in signing for the automations channel. Signing was
 * available to the sender all along, gated on the caller passing a secret, and
 * the automations channel never passed one. Two things have to hold: a trigger
 * with no secret sends exactly the bytes it always did, and a trigger with one
 * sends a signature the documented verifier accepts.
 */

const mockedSend = vi.mocked(sendHttpDestination);

const base = {
  url: "https://example.com/hook",
  body: JSON.stringify({ hello: "world" }),
  triggerName: "My automation",
  eventId: "evt_fixed",
};

const sentHeaders = () =>
  mockedSend.mock.calls[0]![0].headers as Record<string, string>;

beforeEach(() => {
  mockedSend.mockReset();
  mockedSend.mockResolvedValue({
    status: 200,
    body: "",
    responseHeaders: {},
  });
});

describe("webhook signing", () => {
  describe("when the trigger has no signing secret", () => {
    it("sends no signature header at all", async () => {
      await sendWebhook(base);
      expect(sentHeaders()[WEBHOOK_SIGNATURE_HEADER]).toBeUndefined();
    });

    it("sends the same header set an empty secret list produces", async () => {
      await sendWebhook(base);
      const withoutField = sentHeaders();
      mockedSend.mockClear();
      await sendWebhook({ ...base, signingSecrets: [] });
      expect(sentHeaders()).toEqual(withoutField);
    });
  });

  describe("when the trigger has a signing secret", () => {
    it("sends a signature the documented verifier accepts", async () => {
      await sendWebhook({ ...base, signingSecrets: ["whsec_automations"] });
      const header = sentHeaders()[WEBHOOK_SIGNATURE_HEADER];
      expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
      expect(
        verifyWebhookSignature({
          secret: "whsec_automations",
          body: base.body,
          header: header!,
          nowSeconds: Math.floor(Date.now() / 1000),
        }),
      ).toBe(true);
    });

    it("rejects a signature checked against the wrong secret", async () => {
      await sendWebhook({ ...base, signingSecrets: ["whsec_automations"] });
      expect(
        verifyWebhookSignature({
          secret: "whsec_someone_else",
          body: base.body,
          header: sentHeaders()[WEBHOOK_SIGNATURE_HEADER]!,
          nowSeconds: Math.floor(Date.now() / 1000),
        }),
      ).toBe(false);
    });

    it("leaves every other header exactly as it was", async () => {
      await sendWebhook(base);
      const unsigned = { ...sentHeaders() };
      mockedSend.mockClear();
      await sendWebhook({ ...base, signingSecrets: ["whsec_automations"] });
      const signed = { ...sentHeaders() };
      delete signed[WEBHOOK_SIGNATURE_HEADER];
      expect(signed).toEqual(unsigned);
    });
  });

  describe("during a rotation window", () => {
    it("signs with both secrets so either verifies", async () => {
      await sendWebhook({
        ...base,
        signingSecrets: ["whsec_new", "whsec_old"],
      });
      const header = sentHeaders()[WEBHOOK_SIGNATURE_HEADER]!;
      const nowSeconds = Math.floor(Date.now() / 1000);
      expect(
        verifyWebhookSignature({
          secret: "whsec_new",
          body: base.body,
          header,
          nowSeconds,
        }),
      ).toBe(true);
      expect(
        verifyWebhookSignature({
          secret: "whsec_old",
          body: base.body,
          header,
          nowSeconds,
        }),
      ).toBe(true);
    });
  });
});

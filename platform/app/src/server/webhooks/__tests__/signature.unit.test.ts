import { describe, expect, it } from "vitest";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from "../signature";

const SECRET = "whsec_test_secret_value";
const OLD_SECRET = "whsec_previous_secret_value";
const BODY = JSON.stringify({ batch: [{ id: "req_1", type: "test" }] });

describe("webhook signature", () => {
  /** @scenario Every delivery carries a verifiable signature */
  it("signs t=,v1= and the reference verifier accepts it", () => {
    const t = 1_753_000_000;
    const header = signWebhookPayload({
      secrets: [SECRET],
      body: BODY,
      timestampSeconds: t,
    });
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        header,
        nowSeconds: t + 10,
      }),
    ).toBe(true);
  });

  it("matches the documented reference vector", () => {
    // Pinned so the docs' verification snippet can never drift from the
    // sender: hmac-sha256(secret, "<t>.<raw body>") hex.
    const header = signWebhookPayload({
      secrets: ["whsec_fixed"],
      body: '{"a":1}',
      timestampSeconds: 1700000000,
    });
    expect(header).toBe(
      "t=1700000000,v1=9bc8e75d9aeea7b095d6f57ca0bbb0bc17fe72870d03beed18695fbf6e31a40e",
    );
  });

  /** @scenario A tampered body fails verification */
  it("rejects an altered body", () => {
    const t = 1_753_000_000;
    const header = signWebhookPayload({
      secrets: [SECRET],
      body: BODY,
      timestampSeconds: t,
    });
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY.replace("req_1", "req_2"),
        header,
        nowSeconds: t + 10,
      }),
    ).toBe(false);
  });

  /** @scenario A stale signature outside the tolerance window is rejected */
  it("rejects a signature older than the tolerance", () => {
    const t = 1_753_000_000;
    const header = signWebhookPayload({
      secrets: [SECRET],
      body: BODY,
      timestampSeconds: t,
    });
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        header,
        nowSeconds: t + WEBHOOK_SIGNATURE_TOLERANCE_SECONDS + 60,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        header,
        nowSeconds: t + WEBHOOK_SIGNATURE_TOLERANCE_SECONDS - 60,
      }),
    ).toBe(true);
  });

  it("rejects a wrong secret and malformed headers", () => {
    const t = 1_753_000_000;
    const header = signWebhookPayload({
      secrets: [SECRET],
      body: BODY,
      timestampSeconds: t,
    });
    expect(
      verifyWebhookSignature({
        secret: "whsec_other",
        body: BODY,
        header,
        nowSeconds: t,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: BODY,
        header: "v1=deadbeef",
        nowSeconds: t,
      }),
    ).toBe(false);
  });

  describe("given a rotation window with two valid secrets", () => {
    const t = 1_753_000_000;
    const rotating = () =>
      signWebhookPayload({
        secrets: [SECRET, OLD_SECRET],
        body: BODY,
        timestampSeconds: t,
      });

    /** @scenario During a secret rotation a delivery verifies under either secret */
    it("emits one v1 per secret, newest first", () => {
      expect(rotating()).toMatch(/^t=\d+,v1=[0-9a-f]{64},v1=[0-9a-f]{64}$/);
      // Newest first, so a receiver reading only the first v1 follows the
      // roll rather than lagging it.
      const single = signWebhookPayload({
        secrets: [SECRET],
        body: BODY,
        timestampSeconds: t,
      });
      expect(rotating().startsWith(single)).toBe(true);
    });

    it("verifies under the new secret", () => {
      expect(
        verifyWebhookSignature({
          secret: SECRET,
          body: BODY,
          header: rotating(),
          nowSeconds: t + 10,
        }),
      ).toBe(true);
    });

    it("verifies under the secret still being rolled off", () => {
      // The whole point of the window: a receiver that has not yet swapped
      // keeps taking delivery instead of failing its way to auto-disable.
      expect(
        verifyWebhookSignature({
          secret: OLD_SECRET,
          body: BODY,
          header: rotating(),
          nowSeconds: t + 10,
        }),
      ).toBe(true);
    });

    it("still rejects a secret that was never valid", () => {
      expect(
        verifyWebhookSignature({
          secret: "whsec_never_issued",
          body: BODY,
          header: rotating(),
          nowSeconds: t + 10,
        }),
      ).toBe(false);
    });

    it("stops accepting the old secret once the window closes", () => {
      // After expiry the service signs with the current secret alone, so the
      // old one no longer appears in the header and no longer verifies.
      const afterExpiry = signWebhookPayload({
        secrets: [SECRET],
        body: BODY,
        timestampSeconds: t,
      });
      expect(
        verifyWebhookSignature({
          secret: OLD_SECRET,
          body: BODY,
          header: afterExpiry,
          nowSeconds: t + 10,
        }),
      ).toBe(false);
      expect(
        verifyWebhookSignature({
          secret: SECRET,
          body: BODY,
          header: afterExpiry,
          nowSeconds: t + 10,
        }),
      ).toBe(true);
    });
  });
});

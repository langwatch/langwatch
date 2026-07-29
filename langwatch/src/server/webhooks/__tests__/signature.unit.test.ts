import { describe, expect, it } from "vitest";
import {
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from "../signature";

const SECRET = "whsec_test_secret_value";
const BODY = JSON.stringify({ batch: [{ id: "req_1", type: "test" }] });

describe("webhook signature", () => {
  /** @scenario Every delivery carries a verifiable signature */
  it("signs t=,v1= and the reference verifier accepts it", () => {
    const t = 1_753_000_000;
    const header = signWebhookPayload({
      secret: SECRET,
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
      secret: "whsec_fixed",
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
      secret: SECRET,
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
      secret: SECRET,
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
      secret: SECRET,
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
});

/**
 * @vitest-environment node
 *
 * The ElevenLabs post-call webhook's signature check. A brokered voice call
 * reports its cost nowhere else, so a delivery that verifies wrongly either
 * loses the charge or lets anyone post one.
 *
 * Spec: specs/ai-gateway/realtime-sessions.feature
 */
import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyElevenLabsSignature } from "../elevenlabs";

const SECRET = "wsec_test";
const BODY = '{"type":"post_call_transcription","data":{"conversation_id":"conv_1"}}';

/** The header the vendor sends: `t=<unix seconds>,v0=<hex hmac>`. */
function signed(params: { body?: string; at: number; secret?: string }): string {
  const ts = String(params.at);
  const mac = createHmac("sha256", params.secret ?? SECRET)
    .update(`${ts}.${params.body ?? BODY}`)
    .digest("hex");
  return `t=${ts},v0=${mac}`;
}

describe("given an ElevenLabs post-call delivery", () => {
  const now = 1_780_000_000;

  it("accepts a delivery signed with the stored secret", () => {
    expect(
      verifyElevenLabsSignature({
        rawBody: BODY,
        header: signed({ at: now }),
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it("refuses a delivery whose body was changed after signing", () => {
    // The signature covers the exact bytes, which is why the handler reads
    // the raw text and never re-serialises the JSON.
    expect(
      verifyElevenLabsSignature({
        rawBody: BODY.replace("conv_1", "conv_2"),
        header: signed({ at: now }),
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  /** @scenario A delivery signed with the wrong secret is refused */
  it("refuses a delivery signed with another secret", () => {
    expect(
      verifyElevenLabsSignature({
        rawBody: BODY,
        header: signed({ at: now, secret: "wsec_other" }),
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  /** @scenario A replayed delivery outside the signature tolerance is refused */
  it("refuses a captured delivery replayed later", () => {
    // The timestamp is inside the signed payload, so it cannot be moved
    // without breaking the signature; bounding it is what stops the replay.
    expect(
      verifyElevenLabsSignature({
        rawBody: BODY,
        header: signed({ at: now - 3 * 60 * 60 }),
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("refuses a malformed or absent header", () => {
    for (const header of [
      undefined,
      "",
      "v0=deadbeef",
      `t=${now}`,
      "t=notanumber,v0=deadbeef",
    ]) {
      expect(
        verifyElevenLabsSignature({
          rawBody: BODY,
          header,
          secret: SECRET,
          nowSeconds: now,
        }),
      ).toBe(false);
    }
  });

  it("refuses every delivery when no secret is stored", () => {
    // The route answers 404 before reaching this, so a provider id with no
    // webhook configured looks the same as one that does not exist.
    expect(
      verifyElevenLabsSignature({
        rawBody: BODY,
        header: signed({ at: now }),
        secret: "",
        nowSeconds: now,
      }),
    ).toBe(false);
  });
});

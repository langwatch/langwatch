/**
 * @vitest-environment node
 * The signed timestamp window of the ElevenLabs post-call webhook.
 */
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { GatewayElevenLabsWebhookService } from "../gateway-elevenlabs-webhook.service.ts";

const SECRET = "wsec_test";
const BODY = '{"type":"post_call_transcription","data":{"conversation_id":"conv_1"}}';
const NOW = 1_780_000_000;

function verifyAt({ ageSeconds }: { ageSeconds: number }): boolean {
  const timestamp = String(NOW - ageSeconds);
  const mac = createHmac("sha256", SECRET).update(`${timestamp}.${BODY}`).digest("hex");
  return GatewayElevenLabsWebhookService.verifySignature({
    rawBody: BODY,
    header: `t=${timestamp},v0=${mac}`,
    secret: SECRET,
    nowSeconds: NOW,
  });
}

describe("given a signed ElevenLabs post-call delivery", () => {
  it("accepts one signed four minutes ago", () => {
    expect(verifyAt({ ageSeconds: 4 * 60 })).toBe(true);
  });

  it("refuses one signed ten minutes ago", () => {
    expect(verifyAt({ ageSeconds: 10 * 60 })).toBe(false);
  });

  it("refuses one signed ten minutes in the future", () => {
    expect(verifyAt({ ageSeconds: -10 * 60 })).toBe(false);
  });
});

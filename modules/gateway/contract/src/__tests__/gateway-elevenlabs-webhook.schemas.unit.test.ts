import { describe, expect, it } from "vitest";

import { gatewayElevenLabsWebhookParamsSchema } from "../gateway-elevenlabs-webhook.schemas.ts";

describe("gatewayElevenLabsWebhookParamsSchema", () => {
  it("accepts a model provider id", () => {
    const parsed = gatewayElevenLabsWebhookParamsSchema.safeParse({
      modelProviderId: "mp_Ab-12_x",
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses an id carrying a NUL byte", () => {
    const parsed = gatewayElevenLabsWebhookParamsSchema.safeParse({ modelProviderId: "mp\u0000x" });

    expect(parsed.success).toBe(false);
  });
});

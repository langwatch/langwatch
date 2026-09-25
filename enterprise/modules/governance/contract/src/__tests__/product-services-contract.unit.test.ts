import { describe, expect, it } from "vitest";

import {
  AI_TOOL_STARTER_TILES,
  aiToolConfigEnvelopeSchema,
  cliBootstrapResultSchema,
} from "../index.ts";

describe("Governance product contracts", () => {
  it("validates tool config against its discriminator", () => {
    expect(
      aiToolConfigEnvelopeSchema.validate({
        type: "model_provider",
        config: { providerKey: "openai" },
      }),
    ).toBe(true);
    expect(
      aiToolConfigEnvelopeSchema.validate({
        type: "model_provider",
        config: { setupCommand: "langwatch claude" },
      }),
    ).toBe(false);
    expect(AI_TOOL_STARTER_TILES).toHaveLength(9);
  });

  it("round-trips CLI bootstrap output through JSON", () => {
    const bootstrap = cliBootstrapResultSchema.parse({
      tools: [],
      providers: [],
      gatewayProviders: [],
      budget: {
        monthlyLimitUsd: null,
        monthlyUsedUsd: 0,
        period: "MONTHLY",
      },
      gatewayUrl: "https://gateway.example.com",
      adminEmail: null,
      toolPolicies: {
        claude: { allowVk: true, allowOtelDirect: true },
        codex: { allowVk: true, allowOtelDirect: true },
        gemini: { allowVk: true, allowOtelDirect: true },
        opencode: { allowVk: true, allowOtelDirect: true },
        cursor: { allowVk: true, allowOtelDirect: false },
        copilot: { allowVk: true, allowOtelDirect: true },
        code: { allowVk: false, allowOtelDirect: true },
      },
    });
    expect(JSON.parse(JSON.stringify(bootstrap))).toEqual(bootstrap);
  });
});

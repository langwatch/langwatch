import { describe, expect, it } from "vitest";

import {
  AI_TOOL_STARTER_TILES,
  aiToolConfigEnvelopeSchema,
  cliBootstrapResultSchema,
  PLATFORM_TOOL_POLICY_DEFAULTS,
  PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE,
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
    expect(AI_TOOL_STARTER_TILES).toHaveLength(10);
  });

  /** @scenario "The server's tool policy lets pi send telemetry but never use a gateway key" */
  it("defaults pi to direct telemetry only and maps its ingest key to that policy", () => {
    expect(PLATFORM_TOOL_POLICY_DEFAULTS.pi).toEqual({ allowVk: false, allowOtelDirect: true });
    expect(PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE.pi_cli).toBe("pi");
  });

  /** @scenario "pi is offered as an AI tool that sets up with `langwatch pi`" */
  it("lists pi as a coding assistant tile set up with langwatch pi", () => {
    const pi = AI_TOOL_STARTER_TILES.filter((tile) => tile.slug === "pi");

    expect(pi).toHaveLength(1);
    expect(pi[0]).toMatchObject({
      type: "coding_assistant",
      config: {
        assistantKind: "pi",
        setupCommand: "langwatch pi",
        allowVk: false,
        bundledPlan: false,
      },
    });
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
        grok: { allowVk: false, allowOtelDirect: true },
        pi: { allowVk: false, allowOtelDirect: true },
      },
    });
    expect(JSON.parse(JSON.stringify(bootstrap))).toEqual(bootstrap);
  });

  /** @scenario "CLI bootstrap reports the first admin's stored email as stored" */
  it("keeps a stored admin email that is not RFC-valid", () => {
    const bootstrap = cliBootstrapResultSchema.parse({
      tools: [],
      providers: [],
      gatewayProviders: [],
      budget: { monthlyLimitUsd: null, monthlyUsedUsd: 0, period: "MONTHLY" },
      gatewayUrl: "https://gateway.example.com",
      adminEmail: "not an email",
      toolPolicies: {
        claude: { allowVk: true, allowOtelDirect: true },
        codex: { allowVk: true, allowOtelDirect: true },
        gemini: { allowVk: true, allowOtelDirect: true },
        opencode: { allowVk: true, allowOtelDirect: true },
        cursor: { allowVk: true, allowOtelDirect: false },
        copilot: { allowVk: true, allowOtelDirect: true },
        code: { allowVk: false, allowOtelDirect: true },
        grok: { allowVk: false, allowOtelDirect: true },
        pi: { allowVk: false, allowOtelDirect: true },
      },
    });
    expect(bootstrap.adminEmail).toBe("not an email");
  });
});

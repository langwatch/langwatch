import { describe, expect, it } from "vitest";
import {
  AI_TOOL_STARTER_TILES,
  aiToolConfigEnvelopeSchema,
  cliBootstrapResultSchema,
  issuedPersonalVirtualKeySchema,
  routingPolicySchema,
  toRoutingPolicyScopeType,
} from "../index";

describe("Governance product contracts", () => {
  it("keeps routing policies transport-safe", () => {
    const policy = routingPolicySchema.parse({
      id: "policy",
      organizationId: "organization",
      name: "Default",
      description: null,
      modelProviderIds: ["provider"],
      modelAliases: {},
      defaultModel: null,
      policyRules: {},
      isDefault: true,
      createdAtMs: 1,
      updatedAtMs: 2,
      createdById: "user",
      updatedById: "user",
      scopes: [{ scopeType: "ORGANIZATION", scopeId: "organization" }],
    });
    expect(JSON.parse(JSON.stringify(policy))).toEqual(policy);
    expect(toRoutingPolicyScopeType("project")).toBe("PROJECT");
  });

  it("validates tool config against its discriminator", () => {
    expect(
      aiToolConfigEnvelopeSchema.safeParse({
        type: "model_provider",
        config: { providerKey: "openai" },
      }).success,
    ).toBe(true);
    expect(
      aiToolConfigEnvelopeSchema.safeParse({
        type: "model_provider",
        config: { setupCommand: "langwatch claude" },
      }).success,
    ).toBe(false);
    expect(AI_TOOL_STARTER_TILES).toHaveLength(9);
  });

  it("round-trips issued keys and CLI bootstrap output through JSON", () => {
    const key = issuedPersonalVirtualKeySchema.parse({
      virtualKey: {
        id: "key",
        organizationId: "organization",
        name: "default",
        description: "Personal virtual key",
        displayPrefix: "vk-lw-test",
        status: "ACTIVE",
        principalUserId: "user",
        routingPolicyId: null,
        createdAtMs: 1,
        updatedAtMs: 1,
        lastUsedAtMs: null,
        scopes: [{ scopeType: "PROJECT", scopeId: "project" }],
      },
      secret: "secret",
      baseUrl: "https://gateway.example.com",
      routingPolicyId: null,
      id: "key",
      label: "default",
    });
    expect(JSON.parse(JSON.stringify(key))).toEqual(key);

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

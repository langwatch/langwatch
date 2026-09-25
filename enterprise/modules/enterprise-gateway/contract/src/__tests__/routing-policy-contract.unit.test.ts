// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import {
  issuedPersonalVirtualKeySchema,
  routingPolicySchema,
  toRoutingPolicyScopeType,
} from "../index.ts";

describe("enterprise gateway routing-policy and personal-key contracts", () => {
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

  it("round-trips issued personal keys through JSON", () => {
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
  });
});

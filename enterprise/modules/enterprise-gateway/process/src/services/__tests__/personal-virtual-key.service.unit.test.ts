import {
  NoEligibleProvidersError,
  type PersonalVirtualKey,
  type RoutingPolicy,
} from "@langwatch/enterprise-gateway-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { gatewayKey } from "../../__tests__/support/gateway-virtual-key.fixture.ts";
import type { PersonalVirtualKeyIssuerService } from "../personal-virtual-key-issuer.service.ts";
import { PersonalVirtualKeyService } from "../personal-virtual-key.service.ts";

const key: PersonalVirtualKey = {
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
};

class MemoryIssuer implements Pick<PersonalVirtualKeyIssuerService, "issue" | "revoke"> {
  issue = vi.fn(async () => ({ virtualKey: key, secret: "secret" }));
  revoke = vi.fn(async () => key);
}

class MemoryOrganizations {
  ensurePersonalWorkspace = vi.fn(async () => ({
    team: { id: "team", name: "Mine", slug: "mine", createdAtMs: 1 },
    project: {
      id: "project",
      name: "Personal Workspace",
      slug: "personal",
      apiKey: "pkey",
      createdAtMs: 1,
    },
    created: false,
  }));
}

class MemoryPolicies {
  findAll = vi.fn(async () => []);
  findById = vi.fn(async () => null);
  create = vi.fn();
  update = vi.fn();
  setDefault = vi.fn();
  delete = vi.fn();
  findDefaultForUser = vi.fn(async (): Promise<RoutingPolicy | null> => null);
}

function setup({ eligible = 1, held = [gatewayKey()] } = {}) {
  const scopesCounted: unknown[] = [];
  const issuer = new MemoryIssuer();
  const service = PersonalVirtualKeyService.create({
    keys: createApiFixture<GatewayApi>({
      findPersonalVirtualKeys: async () => held,
      findVirtualKeyById: async (id) => held.find((candidate) => candidate.id === id) ?? null,
    }),
    providers: createApiFixture<ModelProviderApi>({
      countEnabledInScopes: async ({ scopes }) => {
        scopesCounted.push(scopes);
        return eligible;
      },
    }),
    issuer,
    organizations: new MemoryOrganizations(),
    policies: new MemoryPolicies(),
    gatewayBaseUrl: "https://gateway.example.com",
  });
  return { issuer, service, scopesCounted };
}

describe("PersonalVirtualKeyService", () => {
  it("mints without a policy when a reachable provider exists", async () => {
    const { issuer, service } = setup();
    const issued = await service.issue({
      userId: "user",
      organizationId: "organization",
      personalProjectId: "project",
      personalTeamId: "team",
      label: "default",
    });
    expect(issued.routingPolicyId).toBeNull();
    expect(issuer.issue).toHaveBeenCalledWith(expect.objectContaining({ routingPolicyId: null }));
  });

  it("refuses a key when neither policy nor provider exists", async () => {
    const { service } = setup({ eligible: 0 });
    await expect(
      service.issue({
        userId: "user",
        organizationId: "organization",
        personalProjectId: "project",
        label: "default",
      }),
    ).rejects.toBeInstanceOf(NoEligibleProvidersError);
  });

  it("counts enabled providers at the organization, the personal team and the personal project", async () => {
    const { service, scopesCounted } = setup();
    await service.issue({
      userId: "user",
      organizationId: "organization",
      personalProjectId: "project",
      personalTeamId: "team",
      label: "laptop",
    });
    expect(scopesCounted).toEqual([
      [
        { scopeType: "ORGANIZATION", scopeId: "organization" },
        { scopeType: "TEAM", scopeId: "team" },
        { scopeType: "PROJECT", scopeId: "project" },
      ],
    ]);
  });

  it("refuses to revoke a key somebody else holds", async () => {
    const { issuer, service } = setup({ held: [gatewayKey({ principalUserId: "other" })] });
    await expect(
      service.revoke({ userId: "user", organizationId: "organization", virtualKeyId: "key" }),
    ).rejects.toMatchObject({ virtualKeyId: "key" });
    expect(issuer.revoke).not.toHaveBeenCalled();
  });

  it("knows a label the person already holds live", async () => {
    const { service } = setup();
    await expect(
      service.hasLiveKeyLabelled({
        organizationId: "organization",
        userId: "user",
        label: "default",
      }),
    ).resolves.toBe(true);
    await expect(
      service.hasLiveKeyLabelled({
        organizationId: "organization",
        userId: "user",
        label: "laptop",
      }),
    ).resolves.toBe(false);
  });
});

describe("given a member with no default personal key yet", () => {
  describe("when they ask for their default personal key", () => {
    /** @scenario "Any member can mint their own default personal VK, scoped to their personal project" */
    it("mints it on their personal project with their team's default policy, and answers the secret", async () => {
      const issuer = new MemoryIssuer();
      const teamDefault: RoutingPolicy = {
        id: "policy_team_default",
        organizationId: "organization",
        name: "Team default",
        description: null,
        modelProviderIds: ["provider_openai"],
        modelAliases: {},
        defaultModel: null,
        policyRules: {},
        isDefault: true,
        createdAtMs: 1,
        updatedAtMs: 1,
        createdById: null,
        updatedById: null,
        scopes: [],
      };
      const policies = new MemoryPolicies();
      policies.findDefaultForUser.mockResolvedValue(teamDefault);
      const service = PersonalVirtualKeyService.create({
        keys: createApiFixture<GatewayApi>({ findPersonalVirtualKeys: async () => [] }),
        providers: createApiFixture<ModelProviderApi>({ countEnabledInScopes: async () => 1 }),
        issuer,
        organizations: new MemoryOrganizations(),
        policies,
        gatewayBaseUrl: "https://gateway.example.com",
      });

      const issued = await service.ensureDefault({
        userId: "user",
        organizationId: "organization",
      });

      expect(policies.findDefaultForUser).toHaveBeenCalledWith({
        organizationId: "organization",
        personalTeamId: "team",
      });
      expect(issuer.issue).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user",
          organizationId: "organization",
          personalProjectId: "project",
          routingPolicyId: "policy_team_default",
        }),
      );
      expect(issued).toMatchObject({
        secret: "secret",
        baseUrl: "https://gateway.example.com",
        routingPolicyId: "policy_team_default",
      });
    });
  });
});

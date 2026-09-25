import { createApiFixture } from "@langwatch/api-fixture";
import {
  NoEligibleProvidersError,
  type PersonalVirtualKey,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { TeamNotFoundError } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import { gatewayKey } from "../../__tests__/support/gateway-virtual-key.fixture.ts";
import { TestOrganizationService } from "../../__tests__/support/test-organization-service.ts";
import type { PersonalVirtualKeyIssuer } from "../../app/governance.members.ts";
import { DefaultGovernancePersonalVirtualKeyService } from "../governance-personal-key.service.ts";

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

class MemoryIssuer implements PersonalVirtualKeyIssuer {
  issue = vi.fn(async () => ({ virtualKey: key, secret: "secret" }));
  revoke = vi.fn(async () => key);
}

class MemoryOrganizations extends TestOrganizationService {
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
  getPersonalWorkspace = vi.fn(async (): Promise<never> => {
    throw new TeamNotFoundError();
  });
}

class MemoryPolicies {
  findAll = vi.fn(async () => []);
  findById = vi.fn(async () => null);
  create = vi.fn();
  update = vi.fn();
  setDefault = vi.fn();
  delete = vi.fn();
  findDefaultForUser = vi.fn(async () => null);
}

function setup({ eligible = 1, held = [gatewayKey()] } = {}) {
  const scopesCounted: unknown[] = [];
  const issuer = new MemoryIssuer();
  const service = DefaultGovernancePersonalVirtualKeyService.create({
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

describe("DefaultGovernancePersonalVirtualKeyService", () => {
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

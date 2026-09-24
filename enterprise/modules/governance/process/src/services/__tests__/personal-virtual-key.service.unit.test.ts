import {
  NoEligibleProvidersError,
  type PersonalVirtualKey,
} from "@langwatch/enterprise-governance-contract";
import { TeamNotFoundError } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import { TestOrganizationService } from "../../__tests__/support/test-organization-service.ts";
import type { PersonalVirtualKeyIssuer } from "../../app/governance.members.ts";
import { PersonalVirtualKeyRepository } from "../../repositories/personal-virtual-key.repository.ts";
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

class MemoryKeys extends PersonalVirtualKeyRepository {
  eligible = 1;
  findDefault = vi.fn(async () => null);
  findAll = vi.fn(async () => [key]);
  findOwned = vi.fn(async () => key);
  findActiveForUser = vi.fn(async () => [key]);
  countEligibleProviders = vi.fn(async () => this.eligible);
}

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

function setup() {
  const repository = new MemoryKeys();
  const issuer = new MemoryIssuer();
  const service = DefaultGovernancePersonalVirtualKeyService.create({
    repository,
    issuer,
    organizations: new MemoryOrganizations(),
    policies: new MemoryPolicies(),
    gatewayBaseUrl: "https://gateway.example.com",
  });
  return { repository, issuer, service };
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
    const { repository, service } = setup();
    repository.eligible = 0;
    await expect(
      service.issue({
        userId: "user",
        organizationId: "organization",
        personalProjectId: "project",
        label: "default",
      }),
    ).rejects.toBeInstanceOf(NoEligibleProvidersError);
  });
});

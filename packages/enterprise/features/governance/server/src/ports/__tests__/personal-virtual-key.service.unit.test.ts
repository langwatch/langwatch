import { describe, expect, it, vi } from "vitest";
import {
  NoEligibleProvidersError,
  type PersonalVirtualKey,
} from "@langwatch/enterprise-governance-contract";
import {
  PersonalVirtualKeyIssuerPort,
  PersonalVirtualKeyRepository,
} from "../personal-virtual-key.port";
import { DefaultGovernancePersonalVirtualKeyService } from "../../services/governance-personal-key.service";
import { TestOrganizationService } from "./support/test-organization-service";

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
  tryFindDefault = vi.fn(async () => null);
  list = vi.fn(async () => [key]);
  tryFindOwned = vi.fn(async () => key);
  listActiveForUser = vi.fn(async () => [key]);
  countEligibleProviders = vi.fn(async () => this.eligible);
}

class MemoryIssuer extends PersonalVirtualKeyIssuerPort {
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
  tryFindPersonalWorkspace = vi.fn(async () => null);
}

class MemoryPolicies {
  list = vi.fn(async () => []);
  tryFindById = vi.fn(async () => null);
  create = vi.fn();
  update = vi.fn();
  setDefault = vi.fn();
  delete = vi.fn();
  tryResolveDefaultForUser = vi.fn(async () => null);
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

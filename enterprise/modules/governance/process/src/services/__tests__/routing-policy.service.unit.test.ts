import { createApiFixture } from "@langwatch/api-fixture";
import {
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyProviderScopeError,
  type RoutingPolicy,
} from "@langwatch/enterprise-governance-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { describe, expect, it, vi } from "vitest";

import { RoutingPolicyRepository } from "../../repositories/routing-policy.repository.ts";
import { DefaultGovernanceRoutingPolicyService } from "../governance-routing.service.ts";

const policy: RoutingPolicy = {
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
  updatedAtMs: 1,
  createdById: "user",
  updatedById: "user",
  scopes: [{ scopeType: "ORGANIZATION", scopeId: "organization" }],
};

class MemoryRoutingPolicyRepository extends RoutingPolicyRepository {
  create = vi.fn(async () => policy);
  update = vi.fn(async () => policy);
  findAll = vi.fn(async () => [policy]);
  findById = vi.fn(async () => policy);
  setDefault = vi.fn(async () => policy);
  delete = vi.fn(async () => undefined);
  findDefaultForUser = vi.fn(async () => policy);
}

function providersReaching(count: number) {
  return createApiFixture<ModelProviderApi>({ countInOrganization: () => Promise.resolve(count) });
}

describe("DefaultGovernanceRoutingPolicyService", () => {
  it("refuses empty provider chains before persistence", async () => {
    const repository = new MemoryRoutingPolicyRepository();
    const service = DefaultGovernanceRoutingPolicyService.create({
      repository,
      providers: providersReaching(1),
    });
    await expect(
      service.create({
        organizationId: "organization",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "organization" }],
        name: "Default",
        modelProviderIds: [],
        actorUserId: "user",
      }),
    ).rejects.toBeInstanceOf(RoutingPolicyMustHaveProviderError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("refuses moving model aliases", async () => {
    const repository = new MemoryRoutingPolicyRepository();
    const service = DefaultGovernanceRoutingPolicyService.create({
      repository,
      providers: providersReaching(1),
    });
    await expect(
      service.create({
        organizationId: "organization",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "organization" }],
        name: "Default",
        modelProviderIds: ["provider"],
        defaultModel: "openai/latest",
        actorUserId: "user",
      }),
    ).rejects.toBeInstanceOf(RoutingPolicyModelMustBeConcreteError);
  });

  it("rejects providers outside the organization", async () => {
    const repository = new MemoryRoutingPolicyRepository();
    const service = DefaultGovernanceRoutingPolicyService.create({
      repository,
      providers: providersReaching(0),
    });
    await expect(
      service.create({
        organizationId: "organization",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "organization" }],
        name: "Default",
        modelProviderIds: ["provider"],
        actorUserId: "user",
      }),
    ).rejects.toBeInstanceOf(RoutingPolicyProviderScopeError);
  });
});

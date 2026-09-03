import { describe, expect, it, vi } from "vitest";
import {
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyProviderScopeError,
  type RoutingPolicy,
} from "@langwatch/enterprise-governance-contract";
import { RoutingPolicyRepository } from "../routing-policy.port";
import { DefaultGovernanceRoutingPolicyService } from "../../services/governance-routing.service";

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
  reachable = 1;
  create = vi.fn(async () => policy);
  update = vi.fn(async () => policy);
  list = vi.fn(async () => [policy]);
  tryFindById = vi.fn(async () => policy);
  setDefault = vi.fn(async () => policy);
  delete = vi.fn(async () => undefined);
  tryResolveDefaultForUser = vi.fn(async () => policy);
  countReachableModelProviders = vi.fn(async () => this.reachable);
}

describe("DefaultGovernanceRoutingPolicyService", () => {
  it("refuses empty provider chains before persistence", async () => {
    const repository = new MemoryRoutingPolicyRepository();
    const service = DefaultGovernanceRoutingPolicyService.create({ repository });
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
    const service = DefaultGovernanceRoutingPolicyService.create({ repository });
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
    repository.reachable = 0;
    const service = DefaultGovernanceRoutingPolicyService.create({ repository });
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

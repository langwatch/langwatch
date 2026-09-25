// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createApiFixture } from "@langwatch/api-fixture";
import {
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyProviderScopeError,
  type RoutingPolicy,
} from "@langwatch/enterprise-gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { RoutingPolicyRepository } from "../../repositories/routing-policy.repository.ts";
import { RoutingPolicyService } from "../routing-policy.service.ts";

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
  count = vi.fn(async () => 1);
}

function providersReaching(count: number) {
  return createApiFixture<ModelProviderApi>({ countInOrganization: () => Promise.resolve(count) });
}

describe("RoutingPolicyService", () => {
  it("refuses empty provider chains before persistence", async () => {
    const repository = new MemoryRoutingPolicyRepository();
    const service = RoutingPolicyService.create({
      repository,
      providers: providersReaching(1),
      projects: createApiFixture<ProjectApi>(),
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
    const service = RoutingPolicyService.create({
      repository,
      providers: providersReaching(1),
      projects: createApiFixture<ProjectApi>(),
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
    const service = RoutingPolicyService.create({
      repository,
      providers: providersReaching(0),
      projects: createApiFixture<ProjectApi>(),
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

import {
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyProviderScopeError,
  type ResolveDefaultRoutingPolicyInput,
  type RoutingPolicy,
} from "@langwatch/enterprise-gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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
  findDefaultForUser = vi.fn(
    async (_input: ResolveDefaultRoutingPolicyInput): Promise<RoutingPolicy | null> => policy,
  );
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

  describe("when the defaults binding a personal workspace are looked up", () => {
    const teamPolicy: RoutingPolicy = {
      ...policy,
      id: "team-policy",
      scopes: [{ scopeType: "TEAM", scopeId: "personal-team" }],
    };

    function serviceOver(defaults: {
      team: RoutingPolicy | null;
      organization: RoutingPolicy | null;
    }) {
      const repository = new MemoryRoutingPolicyRepository();
      repository.findDefaultForUser.mockImplementation(async (input) =>
        input.personalTeamId && defaults.team ? defaults.team : defaults.organization,
      );

      return RoutingPolicyService.create({
        repository,
        providers: providersReaching(1),
        projects: createApiFixture<ProjectApi>(),
      });
    }

    it("answers the personal team's default before the organization's", async () => {
      const service = serviceOver({ team: teamPolicy, organization: policy });

      const defaults = await service.findDefaults({
        organizationId: "organization",
        personalTeamId: "personal-team",
      });

      expect(defaults.map((found) => found.id)).toEqual(["team-policy", "policy"]);
    });

    it("answers the organization default once when the team has none", async () => {
      const service = serviceOver({ team: null, organization: policy });

      const defaults = await service.findDefaults({
        organizationId: "organization",
        personalTeamId: "personal-team",
      });

      expect(defaults.map((found) => found.id)).toEqual(["policy"]);
    });

    it("answers nothing when no default is set", async () => {
      const service = serviceOver({ team: null, organization: null });

      await expect(service.findDefaults({ organizationId: "organization" })).resolves.toEqual([]);
    });
  });
});

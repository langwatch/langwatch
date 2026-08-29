import { describe, expect, it } from "vitest";
import {
  type DataPrivacyPolicy,
  type DataPrivacyScope,
} from "@langwatch/data-privacy-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { DataPrivacyPolicyRepository } from "../data-privacy.repository";
import { DataPrivacyService } from "../../services/data-privacy.service";

class MemoryDataPrivacyRepository extends DataPrivacyPolicyRepository {
  readonly policies: DataPrivacyPolicy[] = [];
  async findForProjectChain() {
    return [];
  }
  async findAllInOrganization(input: { organizationId: string }) {
    return this.policies.filter(
      (policy) => policy.organizationId === input.organizationId,
    );
  }
  async upsertForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyPolicy["config"];
  }) {
    const policy: DataPrivacyPolicy = {
      id: "policy-1",
      organizationId: input.organizationId,
      scopeType: input.scope.scopeType,
      scopeId: input.scope.scopeId,
      personalOnly: input.personalOnly,
      config: input.config,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    this.policies.push(policy);
    return policy;
  }
  async deleteForScope() {}
  async tryFindById() {
    return null;
  }
}

const projects = {
  getWithTeam: async () => ({
    id: "project-1",
    teamId: "team-1",
    departmentId: null,
    isPersonal: false,
    team: { organizationId: "org-1" },
  }),
} as unknown as ProjectService;
const organizations = {
  getTeamById: async () => ({ organizationId: "org-1" }),
} as unknown as OrganizationService;

describe("DataPrivacyService", () => {
  it("rejects unsafe custom secret patterns before persistence", async () => {
    const repository = new MemoryDataPrivacyRepository();
    const service = DataPrivacyService.create({ repository, projects, organizations });
    await expect(
      service.setForScope({
        scope: { scopeType: "PROJECT", scopeId: "project-1" },
        organizationId: "org-1",
        personalOnly: false,
        config: { secrets: { enabled: true, customPatterns: ["("] } },
      }),
    ).rejects.toThrow("safe regular expression");
    expect(repository.policies).toHaveLength(0);
  });

  it("validates and persists a scoped policy through its repository", async () => {
    const repository = new MemoryDataPrivacyRepository();
    const service = DataPrivacyService.create({ repository, projects, organizations });
    const policy = await service.setForScope({
      scope: { scopeType: "TEAM", scopeId: "team-1" },
      organizationId: "org-1",
      personalOnly: false,
      config: { categories: { input: { disposition: "drop" } } },
    });
    expect(policy.scopeId).toBe("team-1");
    expect(repository.policies).toHaveLength(1);
  });

  it("does not accept department writes without a canonical department owner", async () => {
    const repository = new MemoryDataPrivacyRepository();
    const service = DataPrivacyService.create({ repository, projects, organizations });

    await expect(
      service.setForScope({
        organizationId: "org-1",
        scope: { scopeType: "DEPARTMENT", scopeId: "department-1" },
        personalOnly: false,
        config: { categories: { input: { disposition: "drop" } } },
      }),
    ).rejects.toThrow("canonical department service");
    expect(repository.policies).toHaveLength(0);
  });
});

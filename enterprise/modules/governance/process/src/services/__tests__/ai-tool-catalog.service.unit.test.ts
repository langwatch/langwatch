import { createApiFixture } from "@langwatch/api-fixture";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import { AI_TOOL_STARTER_TILES } from "@langwatch/enterprise-governance-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { DefaultGovernanceAiToolCatalogService } from "../ai-tool-catalog.service.ts";
import { ModelProviderAiToolCatalogService } from "../ai-tool-provider-catalog.service.ts";
import { AiToolProviderReachService } from "../ai-tool-provider-reach.service.ts";

const ORG = "organization";

function world(member: { departmentId: string | null } = { departmentId: null }) {
  const repositories = MemoryGovernanceRepositories.create();
  const scopesAsked: unknown[] = [];
  const organizations = createApiFixture<OrganizationApi>({
    findMemberDepartments: async ({ userIds }) =>
      userIds.map((userId) => ({ userId, departmentId: member.departmentId })),
    findMemberTeamIds: async () => ["team_member"],
    findTeamsWithDepartments: async () => [{ id: "team_a", name: "A", departmentId: null }],
  });
  const catalogue = DefaultGovernanceAiToolCatalogService.create({
    repository: repositories.aiTools,
    slugs: { generate: (name) => `${name.toLowerCase()}-slug` },
    providers: ModelProviderAiToolCatalogService.create(),
    reach: AiToolProviderReachService.create({
      organizations,
      projects: createApiFixture<ProjectApi>({
        listByTeam: async () => [],
        listIdsByOrganization: async () => ["project_a"],
      }),
      modelProviders: createApiFixture<ModelProviderApi>({
        findEnabledProviderKeysInScopes: async ({ scopes }) => {
          scopesAsked.push(scopes);
          return ["openai"];
        },
      }),
    }),
    departments: repositories.departments,
    routingPolicies: createApiFixture<EnterpriseGatewayApi>({
      listRoutingPolicies: async () => [],
    }),
    sources: repositories.ingestionSources,
    members: organizations,
    diagnostics: { warn: () => undefined },
  });
  return { catalogue, repositories, scopesAsked };
}

describe("DefaultGovernanceAiToolCatalogService", () => {
  describe("given a fresh organization", () => {
    it("provisions the complete canonical starter catalogue on the member's first list", async () => {
      const { catalogue } = world();

      const tiles = await catalogue.findForMember({ organizationId: ORG, userId: "user" });

      expect(tiles).toHaveLength(AI_TOOL_STARTER_TILES.length);
    });

    it("keeps Cursor direct OTLP disabled regardless of stored config", async () => {
      const { catalogue } = world();
      await catalogue.ensureDefaultCatalog({ organizationId: ORG });

      const policy = await catalogue.resolveToolPolicy({
        organizationId: ORG,
        userId: "user",
        slug: "cursor",
      });

      expect(policy.allowOtelDirect).toBe(false);
    });
  });

  describe("when an admin creates a tile", () => {
    it("validates the per-type config before persistence", async () => {
      const { catalogue } = world();
      const create = catalogue.create({
        organizationId: ORG,
        departmentIds: [],
        type: "model_provider",
        displayName: "Broken",
        config: { setupCommand: "wrong shape" },
      });

      await expect(create).rejects.toThrow(ZodError);
      await expect(catalogue.listForAdmin({ organizationId: ORG })).resolves.toEqual([]);
    });

    it("refuses a department of another organization", async () => {
      const { catalogue, repositories } = world();
      const elsewhere = await repositories.departments.create({
        organizationId: "other",
        name: "Ops",
      });

      await expect(
        catalogue.create({
          organizationId: ORG,
          departmentIds: [elsewhere.id],
          type: "external_tool",
          displayName: "Wiki",
          config: { descriptionMarkdown: "hi", linkUrl: "https://wiki.test" },
        }),
      ).rejects.toThrow("One or more departments do not belong to this organization");
    });
  });

  describe("given a department-bound tile shadowing an org-wide one", () => {
    async function seeded({ inDepartment }: { inDepartment: boolean }) {
      const member = { departmentId: null as string | null };
      const { catalogue, repositories } = world(member);
      const department = await repositories.departments.create({
        organizationId: ORG,
        name: "Eng",
      });
      if (inDepartment) member.departmentId = department.id;
      const config = { descriptionMarkdown: "hi", linkUrl: "https://wiki.test" };
      await repositories.aiTools.create({
        values: {
          organizationId: ORG,
          departmentIds: [],
          type: "external_tool",
          displayName: "Wiki",
          config,
        },
        slug: "wiki",
      });
      await repositories.aiTools.create({
        values: {
          organizationId: ORG,
          departmentIds: [department.id],
          type: "external_tool",
          displayName: "Eng wiki",
          config,
        },
        slug: "wiki",
      });
      return catalogue;
    }

    it("shows the department's tile to its members", async () => {
      const catalogue = await seeded({ inDepartment: true });

      const tiles = await catalogue.listForUser({ organizationId: ORG, userId: "user" });

      expect(tiles.map(({ displayName }) => displayName)).toEqual(["Eng wiki"]);
    });

    it("shows the org-wide tile to everyone else", async () => {
      const catalogue = await seeded({ inDepartment: false });

      const tiles = await catalogue.listForUser({ organizationId: ORG, userId: "user" });

      expect(tiles.map(({ displayName }) => displayName)).toEqual(["Wiki"]);
    });
  });

  describe("when an admin opens the provider picker", () => {
    it("marks the configured provider and offers the unconfigured ones", async () => {
      const { catalogue, scopesAsked } = world();

      const options = await catalogue.listProviderOptionsForAdmin({ organizationId: ORG });

      expect(options.find(({ providerKey }) => providerKey === "openai")?.configured).toBe(true);
      expect(options.some(({ configured }) => !configured)).toBe(true);
      expect(scopesAsked).toEqual([
        [
          { scopeType: "ORGANIZATION", scopeId: ORG },
          { scopeType: "TEAM", scopeId: "team_a" },
          { scopeType: "PROJECT", scopeId: "project_a" },
        ],
      ]);
    });
  });
});

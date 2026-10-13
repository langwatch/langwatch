import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import { AI_TOOL_STARTER_TILES } from "@langwatch/enterprise-governance-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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
  const billingFactsFor: string[] = [];
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
    billingFacts: {
      recordAfterChange: async ({ organizationId }) => {
        billingFactsFor.push(organizationId);
      },
    },
    diagnostics: { warn: () => undefined },
  });
  return { catalogue, repositories, scopesAsked, billingFactsFor };
}

describe("DefaultGovernanceAiToolCatalogService", () => {
  describe("given a fresh organization", () => {
    /** @scenario "A member's first portal load of a zero-row organization returns the provisioned catalog" */
    it("provisions the complete canonical starter catalogue on the member's first list", async () => {
      const { catalogue } = world();

      const tiles = await catalogue.findForMember({ organizationId: ORG, userId: "user" });

      expect(tiles).toHaveLength(AI_TOOL_STARTER_TILES.length);
      expect(tiles.every(({ enabled }) => enabled)).toBe(true);
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

  describe("when an admin edits a coding-assistant tile", () => {
    const tile = {
      organizationId: ORG,
      departmentIds: [],
      type: "coding_assistant" as const,
      displayName: "Codex",
      config: { assistantKind: "codex" as const, setupCommand: "codex", bundledPlan: false },
    };

    /** @scenario "Governance records the billing fact when a coding-assistant config changes" */
    it("records the organization's billing fact after create, update and remove", async () => {
      const { catalogue, billingFactsFor } = world();

      const created = await catalogue.create(tile);
      await catalogue.update({ id: created.id, organizationId: ORG, enabled: false });
      await catalogue.remove({ id: created.id, organizationId: ORG });

      expect(billingFactsFor).toEqual([ORG, ORG, ORG]);
    });

    it("records no billing fact for a tile that is not a coding assistant", async () => {
      const { catalogue, billingFactsFor } = world();

      await catalogue.create({
        organizationId: ORG,
        departmentIds: [],
        type: "external_tool",
        displayName: "Wiki",
        config: { descriptionMarkdown: "hi", linkUrl: "https://wiki.test" },
      });

      expect(billingFactsFor).toEqual([]);
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

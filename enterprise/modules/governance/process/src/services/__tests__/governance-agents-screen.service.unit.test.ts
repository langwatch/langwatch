// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Agent, AgentApi } from "@langwatch/agent-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { GovernanceAgentsScreenService } from "../../features/agents/services/governance-agents-screen.service.ts";
import type { RegistryDraft } from "../../features/registry/rules/registry-entry.rules.ts";
import { planRegistryChanges } from "../../features/registry/rules/registry-reconcile.rules.ts";
import { MemoryAgentRegistryRepository } from "../../repositories/memory/memory.agent-registry.repository.ts";
import { MemoryDiscoveredAgentRepository } from "../../repositories/memory/memory.discovered-agent.repository.ts";
import { MemoryDiscoveredPeopleStore } from "../../repositories/memory/memory.discovered-people.store.ts";

const NOW = fromDate(new Date("2026-09-09T12:00:00.000Z"));
const ORGANIZATION_ID = "org-1";

const connectedAgent: Agent = {
  id: "agent-1",
  projectId: "project-1",
  name: "support-copilot",
  type: "connected",
  config: { parameters: [], sdk: { name: "langwatch", version: "1", language: "python" } },
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date("2026-06-11T12:00:00.000Z"),
  updatedAt: new Date("2026-06-11T12:00:00.000Z"),
  environment: "production",
  ownerUserId: "user-7",
  lastSeenAt: new Date("2026-09-09T11:00:00.000Z"),
};

async function setup({
  projectIds,
  registry = MemoryAgentRegistryRepository.create(),
  registryPageSize,
}: {
  projectIds: string[];
  registry?: MemoryAgentRegistryRepository;
  registryPageSize?: number;
}) {
  const asked: { projectIds: string[] }[] = [];
  const discoveredAgents = MemoryDiscoveredAgentRepository.create(
    MemoryDiscoveredPeopleStore.create(),
  );
  await discoveredAgents.recordAgentSighting({
    organizationId: ORGANIZATION_ID,
    provider: "databricks_genie",
    rawAgentId: "space-1",
    displayText: "revenue-analyst",
    metadata: {},
    seenAt: NOW,
  });
  const { logger } = createTestLogger();
  const service = GovernanceAgentsScreenService.create({
    projects: createApiFixture<ProjectApi>({
      findLiveNonGovernanceIdsByOrganization: async () => projectIds,
    }),
    agents: createApiFixture<AgentApi>({
      findConnectedInProjects: async (input) => {
        asked.push(input);
        return [connectedAgent];
      },
    }),
    organizations: createApiFixture<OrganizationApi>({
      findMembersWithDepartments: async () => [
        {
          userId: "user-7",
          departmentId: null,
          disabledAt: null,
          user: { name: "Dana Okafor", email: null },
        },
      ],
    }),
    discoveredAgents,
    registry,
    logger,
    registryPageSize,
  });
  return { service, asked, discoveredAgents };
}

function registryDraft(overrides: Partial<RegistryDraft> & Pick<RegistryDraft, "sourceKey">) {
  return {
    source: "langwatch",
    management: "managed",
    shadow: false,
    dormant: false,
    platform: null,
    labels: {},
    owner_label: null,
    kind: "connected",
    name: "support-copilot",
    description: null,
    source_version: null,
    project_id: "project-1",
    environment: null,
    owner: null,
    endpoints: [],
    model: null,
    instructions: null,
    capabilities: [],
    tools: [],
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    ...overrides,
  } satisfies RegistryDraft;
}

async function holdInRegistry(registry: MemoryAgentRegistryRepository, drafts: RegistryDraft[]) {
  let next = 0;
  await registry.applyChanges({
    organizationId: ORGANIZATION_ID,
    plan: (stored) =>
      planRegistryChanges({ stored, drafts, now: NOW, newId: () => `agentreg_${++next}` }),
    baselineAt: NOW,
  });
}

describe("GovernanceAgentsScreenService", () => {
  describe("given an organization with a registered and a provider-listed agent", () => {
    /** @scenario "The list holds the agents we registered and the agents we found" */
    it("lists both, reading registered agents from the organization's live projects", async () => {
      const { service, asked } = await setup({ projectIds: ["project-1"] });

      const rows = await service.listAgents({ organizationId: ORGANIZATION_ID, now: NOW });

      expect(asked).toEqual([{ projectIds: ["project-1"] }]);
      expect(rows[0]).toMatchObject({
        id: "registered:agent-1",
        source: "custom",
        owner: "Dana Okafor",
        registeredDaysAgo: 90,
        lastActiveMinutesAgo: 60,
      });
      expect(rows[1]).toMatchObject({ name: "revenue-analyst", source: "databricks", owner: null });
      expect(rows).toHaveLength(2);
    });
  });

  describe("given an organization with no live projects", () => {
    it("asks the agent module for nothing", async () => {
      const { service, asked } = await setup({ projectIds: [] });

      const rows = await service.listAgents({ organizationId: ORGANIZATION_ID, now: NOW });

      expect(asked).toEqual([]);
      expect(rows.map((row) => row.source)).toEqual(["databricks"]);
    });
  });

  describe("given a governed, a shadow and a dormant agent in the registry", () => {
    /** @scenario "The inventory shows each agent's posture" */
    it("gives each row its posture and lists the traced-only agent as a traffic row", async () => {
      const registry = MemoryAgentRegistryRepository.create();
      const { service, discoveredAgents } = await setup({ projectIds: ["project-1"], registry });
      const [listed] = await discoveredAgents.findByOrganization({
        organizationId: ORGANIZATION_ID,
      });
      await holdInRegistry(registry, [
        registryDraft({ sourceKey: "langwatch:agent-1" }),
        registryDraft({
          sourceKey: `discovered:${listed?.id}`,
          source: "aws",
          management: "discovered",
          name: "revenue-analyst",
          project_id: null,
          dormant: true,
          platform: "aws_bedrock",
          model: { provider: null, model: "anthropic.claude-sonnet-5", parameters: {} },
        }),
        registryDraft({
          sourceKey: "traffic:project-1:pricing-bot",
          source: "traffic",
          management: "observed",
          name: "pricing-bot",
          shadow: true,
          model: { provider: "openai", model: "gpt-5", parameters: {} },
        }),
      ]);

      const rows = await service.listAgents({ organizationId: ORGANIZATION_ID, now: NOW });

      expect(rows.map((row) => [row.name, row.source, row.posture, row.platform])).toEqual([
        ["support-copilot", "custom", "governed", null],
        ["revenue-analyst", "databricks", "dormant", "aws_bedrock"],
        ["pricing-bot", "traffic", "shadow", null],
      ]);
      expect(rows[1]).toMatchObject({ models: ["anthropic.claude-sonnet-5"] });
      expect(rows[2]).toMatchObject({ models: ["gpt-5"], lastActiveMinutesAgo: 0 });
    });
  });

  describe("given more active registry entries than one registry page holds", () => {
    it("reads every page, so no traced agent drops off the list", async () => {
      const registry = MemoryAgentRegistryRepository.create();
      const { service } = await setup({ projectIds: [], registry, registryPageSize: 2 });
      await holdInRegistry(
        registry,
        ["a", "b", "c", "d", "e"].map((name) =>
          registryDraft({
            sourceKey: `traffic:project-1:${name}`,
            source: "traffic",
            management: "observed",
            name,
            shadow: true,
          }),
        ),
      );

      const rows = await service.listAgents({ organizationId: ORGANIZATION_ID, now: NOW });

      expect(rows.filter((row) => row.source === "traffic").map((row) => row.name)).toEqual([
        "a",
        "b",
        "c",
        "d",
        "e",
      ]);
    });
  });
});

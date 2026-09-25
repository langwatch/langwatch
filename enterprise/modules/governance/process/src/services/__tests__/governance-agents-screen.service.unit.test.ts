// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Agent, AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryDiscoveredAgentRepository } from "../../repositories/memory/memory.discovered-agent.repository.ts";
import { MemoryDiscoveredPeopleStore } from "../../repositories/memory/memory.discovered-people.store.ts";
import { GovernanceAgentsScreenService } from "../governance-agents-screen.service.ts";

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

async function setup({ projectIds }: { projectIds: string[] }) {
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
        { userId: "user-7", departmentId: null, user: { name: "Dana Okafor", email: null } },
      ],
    }),
    discoveredAgents,
    logger,
  });
  return { service, asked };
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
});

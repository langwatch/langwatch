// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type InternalProject, PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryDiscoveredPeopleStore } from "../../repositories/memory/memory.discovered-people.store.ts";
import { MemoryGovernanceTenantHistoryRepository } from "../../repositories/memory/memory.governance-tenant-history.repository.ts";
import { GovernanceTenantHistoryService } from "../governance-tenant-history.service.ts";

const ORG = "org_1";
const TENANT = "project_gov_1";

function setup() {
  const store = MemoryDiscoveredPeopleStore.create();
  const history = MemoryGovernanceTenantHistoryRepository.create(store);
  const projects = createApiFixture<ProjectApi>({
    ensureInternal: async ({ kind }): Promise<InternalProject> => ({
      id: TENANT,
      name: "Governance",
      slug: `governance-${ORG}`,
      teamId: "team_1",
      kind,
      archivedAtMs: null,
      traceSharingEnabled: false,
    }),
  });
  const service = GovernanceTenantHistoryService.create({ projects, history });
  return { store, history, service };
}

describe("GovernanceTenantHistoryService", () => {
  describe("when an organization's governance area is resolved for the first time", () => {
    /** @scenario "The first time an organization's governance area is used it is recorded" */
    it("records that area against the organization", async () => {
      const { history, service } = setup();

      const project = await service.ensureInternal({
        organizationId: ORG,
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      });

      expect(project.id).toBe(TENANT);
      expect(await history.findAllByOrganization({ organizationId: ORG })).toEqual([
        { organizationId: ORG, tenantId: TENANT },
      ]);
    });
  });

  describe("when the same area is resolved again", () => {
    /** @scenario "Resolving the same area again does not record it twice" */
    it("keeps one record and moves its last use forward", async () => {
      const { store, history, service } = setup();
      const earlier = Temporal.Now.instant().subtract({ hours: 1 });
      await history.append({ organizationId: ORG, tenantId: TENANT, at: earlier });

      await service.ensureInternal({ organizationId: ORG, kind: PROJECT_KIND.INTERNAL_GOVERNANCE });

      expect(store.tenants).toHaveLength(1);
      expect(Temporal.Instant.compare(store.tenants[0]!.lastUsedAt, earlier)).toBe(1);
      expect(Temporal.Instant.compare(store.tenants[0]!.firstUsedAt, earlier)).toBe(0);
    });
  });

  describe("when the history cannot be written", () => {
    it("still answers the project", async () => {
      const { history, service } = setup();
      vi.spyOn(history, "touch").mockRejectedValue(new Error("store down"));

      const project = await service.ensureInternal({
        organizationId: ORG,
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      });

      expect(project.id).toBe(TENANT);
    });
  });
});

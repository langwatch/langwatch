/**
 * @vitest-environment node
 * Organization writes a personal workspace's project row itself, so it records the new workspace
 * and project records the project as created (ARCHITECTURE §9).
 * Spec: specs/lwql/project-key-map.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import type { PersonalWorkspaceIdentity } from "../../app/organization.members.ts";
import type { OrganizationRepository } from "../../repositories/organization.repository.ts";
import {
  PersonalWorkspaceService,
  type PersonalWorkspaceNotices,
} from "../personal-workspace.service.ts";

const IDENTITIES: PersonalWorkspaceIdentity = {
  create: () => ({
    teamId: "team_personal",
    teamSlug: "team-personal",
    projectId: "project_personal",
    projectSlug: "project-personal",
    projectApiKey: "key",
    ownerBindingId: "binding",
  }),
};

function serviceWhere(created: boolean) {
  const repository = createApiFixture<OrganizationRepository>({
    ensurePersonalWorkspace: async () => ({
      workspace: {
        team: { id: "team_personal", name: "Personal", slug: "team-personal", createdAtMs: 1 },
        project: {
          id: "project_personal",
          name: "Personal Workspace",
          slug: "project-personal",
          apiKey: "key",
          createdAtMs: 1,
        },
      },
      created,
    }),
  });
  const personalWorkspaceProvisioned = vi.fn();
  const service = PersonalWorkspaceService.create({
    repository,
    identities: IDENTITIES,
    grants: createApiFixture<AuthzApi>({
      attachBindings: async () => ({ attached: ["binding"], duplicates: [] }),
    }),
    diagnostics: undefined,
    notices: createApiFixture<PersonalWorkspaceNotices>({ personalWorkspaceProvisioned }),
  });
  return { service, personalWorkspaceProvisioned };
}

describe("ensuring a personal workspace", () => {
  describe("when it is created", () => {
    /** @scenario "A personal workspace records its new project" */
    it("records the new workspace with its project, for project to record as created", async () => {
      const { service, personalWorkspaceProvisioned } = serviceWhere(true);

      await service.ensurePersonalWorkspace({ userId: "user_1", organizationId: "org_acme" });

      expect(personalWorkspaceProvisioned).toHaveBeenCalledWith({
        organizationId: "org_acme",
        userId: "user_1",
        projectId: "project_personal",
      });
    });
  });

  describe("when it already exists", () => {
    it("records nothing, since its project was recorded when it was created", async () => {
      const { service, personalWorkspaceProvisioned } = serviceWhere(false);

      await service.ensurePersonalWorkspace({ userId: "user_1", organizationId: "org_acme" });

      expect(personalWorkspaceProvisioned).not.toHaveBeenCalled();
    });
  });
});

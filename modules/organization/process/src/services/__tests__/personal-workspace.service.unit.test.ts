import type { AuthzApi } from "@langwatch/authz-contract";
import { PersonalProjectOwnerMismatchError } from "@langwatch/organization-contract";
/**
 * @vitest-environment node
 * Organization writes a personal workspace's project row itself, so it records the new workspace
 * and project records the project as created (ARCHITECTURE §9).
 * Spec: specs/lwql/project-key-map.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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

describe("reading a personal workspace's features", () => {
  describe("when the caller does not own the project", () => {
    it("refuses as a handled 404, not an internal error", async () => {
      const service = PersonalWorkspaceService.create({
        repository: createApiFixture<OrganizationRepository>({
          getPersonalWorkspaceFeatureProject: async () => ({
            id: "project_personal",
            organizationId: "org_acme",
            isPersonal: true,
            ownerUserId: "someone_else",
            personalFeatures: null,
          }),
        }),
        identities: IDENTITIES,
        grants: createApiFixture<AuthzApi>({}),
        diagnostics: undefined,
        notices: undefined,
      });

      const refusal = await service
        .getPersonalWorkspaceFeatures({ projectId: "project_personal", callerUserId: "user_1" })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(PersonalProjectOwnerMismatchError);
      expect(refusal).toMatchObject({
        code: "personal_project_owner_mismatch",
        httpStatus: 404,
      });
    });
  });
});

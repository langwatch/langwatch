import type { AuthzApi } from "@langwatch/authz-contract";
import {
  PersonalProjectOwnerMismatchError,
  PersonalWorkspacePendingError,
} from "@langwatch/organization-contract";
/**
 * @vitest-environment node
 * Organization creates the personal team and records its fact; project creates the project and
 * mints its key (Round 54). Spec: modules/organization/specs/organization-service.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type {
  EnsuredPersonalTeam,
  OrganizationRepository,
} from "../../../../repositories/organization.repository.ts";
import type { PersonalWorkspaceIdentity } from "../personal-workspace-identity.service.ts";
import {
  PersonalWorkspaceService,
  type PersonalWorkspaceNotices,
} from "../personal-workspace.service.ts";

const IDENTITIES: PersonalWorkspaceIdentity = {
  create: () => ({
    teamId: "team_personal",
    teamSlug: "team-personal",
    projectSlug: "project-personal",
    ownerBindingId: "binding",
  }),
  newProjectId: () => "project_personal",
};

const TEAM = { id: "team_personal", name: "Personal", slug: "team-personal", createdAtMs: 1 };

function serviceWhere(found: EnsuredPersonalTeam) {
  const repository = createApiFixture<OrganizationRepository>({
    ensurePersonalWorkspace: async () => found,
  });
  const personalTeamCreated = vi.fn();
  const service = PersonalWorkspaceService.create({
    repository,
    identities: IDENTITIES,
    grants: createApiFixture<AuthzApi>({
      attachBindings: async () => ({ attached: ["binding"], duplicates: [] }),
    }),
    diagnostics: undefined,
    notices: createApiFixture<PersonalWorkspaceNotices>({ personalTeamCreated }),
  });
  return { service, personalTeamCreated };
}

const INPUT = { userId: "user_1", organizationId: "org_acme" };

describe("ensuring a personal workspace", () => {
  describe("when its personal project is still pending", () => {
    /** @scenario "A new personal workspace answers pending until project has created its project" */
    it("answers pending with the team to wait on", async () => {
      const { service } = serviceWhere({ kind: "pending", team: TEAM });

      await expect(service.ensurePersonalWorkspace(INPUT)).resolves.toEqual({
        kind: "pending",
        team: TEAM,
      });
    });

    /** @scenario "Ensuring again while the personal project is pending creates no second team" */
    it("records the personal team fact on every pending answer, so a lost record heals", async () => {
      const { service, personalTeamCreated } = serviceWhere({ kind: "pending", team: TEAM });

      await service.ensurePersonalWorkspace(INPUT);
      await service.ensurePersonalWorkspace(INPUT);

      expect(personalTeamCreated).toHaveBeenCalledTimes(2);
      expect(personalTeamCreated).toHaveBeenLastCalledWith({
        organizationId: "org_acme",
        userId: "user_1",
        teamId: "team_personal",
        projectId: "project_personal",
        projectSlug: "project-personal",
      });
    });

    /** @scenario "The personal team fact never carries the project key" */
    it("records no key in the fact", async () => {
      const { service, personalTeamCreated } = serviceWhere({ kind: "pending", team: TEAM });

      await service.ensurePersonalWorkspace(INPUT);

      expect(JSON.stringify(personalTeamCreated.mock.calls)).not.toMatch(/apiKey|pkey_/);
    });
  });

  describe("when its personal project exists", () => {
    /** @scenario "Ensuring a personal workspace whose project exists answers ready" */
    it("answers ready with the workspace and records nothing", async () => {
      const workspace = {
        team: TEAM,
        project: {
          id: "project_personal",
          name: "Personal Workspace",
          slug: "project-personal",
          apiKey: "key",
          createdAtMs: 1,
        },
      };
      const { service, personalTeamCreated } = serviceWhere({ kind: "ready", workspace });

      await expect(service.ensurePersonalWorkspace(INPUT)).resolves.toEqual({
        kind: "ready",
        workspace,
      });
      expect(personalTeamCreated).not.toHaveBeenCalled();
    });
  });
});

describe("refusing a change that needs a pending personal project", () => {
  /** @scenario "A mutation that needs a pending personal project refuses as retryable" */
  it("is a retryable 409 handled error", () => {
    const refusal = new PersonalWorkspacePendingError();

    expect(refusal).toMatchObject({
      code: "personal_workspace_pending",
      retryable: true,
      httpStatus: 409,
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

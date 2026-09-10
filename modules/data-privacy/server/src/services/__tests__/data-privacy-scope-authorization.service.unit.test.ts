/**
 * Who may write a privacy rule where.
 * Spec: specs/data-privacy/policy-configuration.feature
 */
import type { AuthzApi, AuthzCanBatchByIdsInput } from "@langwatch/authz-contract";
import type { DataPrivacyProjectLineage } from "@langwatch/data-privacy-server";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";
import { DataPrivacyDirectoryRepository } from "../../repositories/data-privacy-directory.repository.ts";
import { DataPrivacyPermissionsService } from "../data-privacy-permissions.service.ts";
import { DataPrivacyScopeAuthorizationService } from "../data-privacy-scope-authorization.service.ts";

class FakeDirectory extends DataPrivacyDirectoryRepository {
  constructor(
    private readonly rows: {
      lineage?: DataPrivacyProjectLineage | null;
      scopeOrganizationId?: string | null;
    } = {},
  ) {
    super();
  }

  async tryGetProjectLineage() {
    return this.rows.lineage ?? null;
  }
  async listOrganizationDirectory() {
    return { departments: [], teams: [], projects: [], groups: [] };
  }
  async tryResolveScopeOrganizationId() {
    return this.rows.scopeOrganizationId === undefined ? "org-1" : this.rows.scopeOrganizationId;
  }
}

/** A project that sits in `org-1`, as the lineage read answers it. */
const lineageIn = (organizationId: string): DataPrivacyProjectLineage => ({
  projectId: "web-app",
  name: "Web app",
  teamId: "team-1",
  organizationId,
  organizationName: "Acme",
});

/** A caller who can update every project asked about, and nothing above one. */
const projectOnlyAuthz = createApiFixture<AuthzApi>({
  hasPermission: async () => false,
  canBatchByIds: async (input: AuthzCanBatchByIdsInput) => ({
    teams: new Map(input.teams.map((team) => [team.teamId, false])),
    projects: new Map(input.projects.map((project) => [project.projectId, true])),
    organizationRole: null,
  }),
});

function service(
  rows: { lineage?: DataPrivacyProjectLineage | null; scopeOrganizationId?: string | null } = {},
): DataPrivacyScopeAuthorizationService {
  return DataPrivacyScopeAuthorizationService.create({
    directory: new FakeDirectory(rows),
    permissions: DataPrivacyPermissionsService.create({ authz: projectOnlyAuthz }),
  });
}

describe("DataPrivacyScopeAuthorizationService.assertCanWriteScope", () => {
  describe("given a user who can manage project web-app but not the organization", () => {
    /**
     * @scenario A project admin cannot set an organization-wide rule
     * @scenario "A caller without standing at a tier is told which permission it needs"
     */
    it("refuses an organization-level rule and names the permission it wanted", async () => {
      await expect(
        service().assertCanWriteScope({
          userId: "user-1",
          scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
        }),
      ).rejects.toMatchObject({
        code: "data_privacy_scope_write_forbidden",
        httpStatus: 403,
        meta: { scopeType: "ORGANIZATION", requiredPermission: "organization:manage" },
      });
    });

    it("still lets the same user write their own project's rule", async () => {
      await expect(
        service().assertCanWriteScope({
          userId: "user-1",
          scope: { scopeType: "PROJECT", scopeId: "web-app" },
        }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("DataPrivacyScopeAuthorizationService.assertScopeBelongsToProjectOrganization", () => {
  describe("given the scope a rule was aimed at has been removed", () => {
    /** @scenario "A rule aimed at a scope that no longer exists is refused by name" */
    it("refuses with the scope-target code so the page can send the reader back to the picker", async () => {
      await expect(
        service({
          scopeOrganizationId: null,
          lineage: lineageIn("org-1"),
        }).assertScopeBelongsToProjectOrganization({
          projectId: "web-app",
          scope: { scopeType: "TEAM", scopeId: "gone" },
        }),
      ).rejects.toMatchObject({
        code: "data_privacy_scope_target_not_found",
        httpStatus: 404,
      });
    });
  });

  describe("given the scope belongs to another organization than the project", () => {
    /** @scenario "A rule aimed outside the project's organization is refused by name" */
    it("refuses with the outside-organization code", async () => {
      await expect(
        service({
          scopeOrganizationId: "org-2",
          lineage: lineageIn("org-1"),
        }).assertScopeBelongsToProjectOrganization({
          projectId: "web-app",
          scope: { scopeType: "TEAM", scopeId: "team-elsewhere" },
        }),
      ).rejects.toMatchObject({
        code: "data_privacy_scope_outside_organization",
        httpStatus: 400,
      });
    });
  });

  describe("given the project the page was opened from is gone", () => {
    /** @scenario "A rule written from a project that is gone is refused by name" */
    it("refuses with the project code rather than a scope one", async () => {
      await expect(
        service({ lineage: null }).assertScopeBelongsToProjectOrganization({
          projectId: "web-app",
          scope: { scopeType: "TEAM", scopeId: "team-1" },
        }),
      ).rejects.toMatchObject({ code: "project_not_found", httpStatus: 404 });
    });
  });

  describe("given the scope sits in the project's own organization", () => {
    it("accepts the target", async () => {
      await expect(
        service({
          scopeOrganizationId: "org-1",
          lineage: lineageIn("org-1"),
        }).assertScopeBelongsToProjectOrganization({
          projectId: "web-app",
          scope: { scopeType: "TEAM", scopeId: "team-1" },
        }),
      ).resolves.toBeUndefined();
    });
  });
});

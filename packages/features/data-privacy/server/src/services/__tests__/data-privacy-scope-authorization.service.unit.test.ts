/**
 * Who may write a privacy rule where.
 * Spec: specs/data-privacy/policy-configuration.feature
 */
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { DataPrivacyDirectoryPort } from "../../ports/data-privacy-directory.port";
import { DataPrivacyPermissionsPort } from "../../ports/data-privacy-permissions.port";
import { DataPrivacyScopeAuthorizationService } from "../data-privacy-scope-authorization.service";

class FakeDirectory extends DataPrivacyDirectoryPort {
  async tryGetProjectLineage() {
    return null;
  }
  async listOrganizationDirectory() {
    return { departments: [], teams: [], projects: [], groups: [] };
  }
  async tryResolveScopeOrganizationId() {
    return "org-1";
  }
}

/** A caller who can update one project, and nothing at the organization tier. */
class ProjectOnlyPermissions extends DataPrivacyPermissionsPort {
  async canManageOrganization() {
    return false;
  }
  async canManageTeams() {
    return new Map();
  }
  async canUpdateProjects(input: { projectIds: readonly string[] }) {
    return new Map(input.projectIds.map((id) => [id, true]));
  }
}

function service(): DataPrivacyScopeAuthorizationService {
  return DataPrivacyScopeAuthorizationService.create({
    directory: new FakeDirectory(),
    permissions: new ProjectOnlyPermissions(),
  });
}

describe("DataPrivacyScopeAuthorizationService.assertCanWriteScope", () => {
  describe("given a user who can manage project web-app but not the organization", () => {
    /** @scenario A project admin cannot set an organization-wide rule */
    it("rejects an attempt to set an organization-level rule as forbidden", async () => {
      await expect(
        service().assertCanWriteScope({
          userId: "user-1",
          scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
        }),
      ).rejects.toThrow(TRPCError);
      await expect(
        service().assertCanWriteScope({
          userId: "user-1",
          scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
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

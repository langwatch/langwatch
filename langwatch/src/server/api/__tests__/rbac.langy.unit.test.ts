/**
 * @see specs/security/api-endpoint-authorization.feature
 *
 * Langy has its own permission family rather than riding on `evaluations:view`.
 * Starting a turn is not a read: it provisions credentials, spawns an OpenCode
 * worker and spends the project's model budget, so it must not be buyable with
 * a view grant. These tests pin the default role matrix, which is the product
 * contract — a silent widening here hands turn-spend to read-only accounts.
 */
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  organizationRoleHasPermission,
  teamRoleHasPermission,
} from "../rbac";

const WRITE_PERMISSIONS = [
  "langy:create",
  "langy:update",
  "langy:delete",
] as const;

describe("Langy permissions", () => {
  describe("given a project VIEWER", () => {
    // Below MEMBER gets no Langy at all. The permission grain is not what
    // keeps Langy scarce — `release_langy_enabled` is — so the line is drawn
    // at "can this person act on the project", not at read-vs-write.
    /** @scenario "Below member, Langy is not granted at all" */
    it.each(["langy:view", ...WRITE_PERMISSIONS, "langy:manage"] as const)(
      "does not hold %s",
      (permission) => {
        expect(teamRoleHasPermission(TeamUserRole.VIEWER, permission)).toBe(
          false,
        );
      },
    );
  });

  describe("given a project MEMBER", () => {
    it("can read Langy conversations", () => {
      expect(teamRoleHasPermission(TeamUserRole.MEMBER, "langy:view")).toBe(
        true,
      );
    });

    it.each(WRITE_PERMISSIONS)("can %s", (permission) => {
      expect(teamRoleHasPermission(TeamUserRole.MEMBER, permission)).toBe(true);
    });

    /** @scenario "A member can run Langy but cannot administer it" */
    it("cannot administer Langy", () => {
      // `langy:manage` also gates the org-wide GitHub App connection.
      expect(teamRoleHasPermission(TeamUserRole.MEMBER, "langy:manage")).toBe(
        false,
      );
    });
  });

  describe("given a project ADMIN", () => {
    it("can administer Langy", () => {
      expect(teamRoleHasPermission(TeamUserRole.ADMIN, "langy:manage")).toBe(
        true,
      );
    });

    it.each(WRITE_PERMISSIONS)("holds %s via the manage hierarchy", (p) => {
      // ADMIN is granted `langy:manage`, not each write permission by name;
      // the hierarchy rule is what makes the writes resolve.
      expect(teamRoleHasPermission(TeamUserRole.ADMIN, p)).toBe(true);
    });
  });

  describe("given the org-tier GitHub App connection", () => {
    it("is available to an organization ADMIN", () => {
      expect(
        organizationRoleHasPermission(
          OrganizationUserRole.ADMIN,
          "langy:manage",
        ),
      ).toBe(true);
    });

    it.each([OrganizationUserRole.MEMBER, OrganizationUserRole.EXTERNAL])(
      "is not available to an organization %s",
      (role) => {
        // EXTERNAL is the lite-member tier; before Langy had its own
        // permission family, membership alone let it enumerate the org's
        // private repositories through langyGithub.listRepos.
        expect(organizationRoleHasPermission(role, "langy:manage")).toBe(false);
      },
    );
  });
});

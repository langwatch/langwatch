/**
 * The project's set and its organization's set come from one snapshot load:
 * specs/frontend/session-permission-reads.feature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub.ts";
import { StubAuthzManagedGrantRepository } from "../../repositories/__tests__/support/authz-managed-grant.stub.ts";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub.ts";
import { AuthzGrantSnapshotService } from "../authz-grant-snapshot.service.ts";
import { AuthzService } from "../authz.service.ts";

const ORG = "org-1";
const PROJECT_SCOPE = {
  type: "project",
  id: "proj-1",
  teamId: "team-1",
  organizationId: ORG,
} as const;
const LITE_MEMBER = { type: "user", id: "user-lite" } as const;

/** A Lite Member admitted by domain: in the organization, with no grant on any project. */
function liteMemberWithNoProjectGrant() {
  const reader = makeReader({
    findOrganizationMembership: vi.fn().mockResolvedValue({ role: "EXTERNAL", disabled: false }),
    findProjectLineage: vi.fn().mockResolvedValue({ teamId: "team-1", organizationId: ORG }),
  });
  const authz = AuthzService.create({
    isOnEngine: async () => true,
    repository: reader,
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzManagedGrantRepository(),
  });
  return { authz, reader };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given a Lite Member with no grant on the project", () => {
  describe("when the project's and the organization's sets are asked together", () => {
    /** @scenario "The project page's one grant read carries the organization's permissions too" */
    it("loads the grant snapshot once", async () => {
      const collect = vi.spyOn(AuthzGrantSnapshotService.prototype, "collectWithOwnerCeiling");
      const { authz, reader } = liteMemberWithNoProjectGrant();

      await authz.effectivePermissionsWithOrganization({
        principal: LITE_MEMBER,
        scope: PROJECT_SCOPE,
      });

      expect(collect).toHaveBeenCalledTimes(1);
      expect(reader.findOrganizationMembership).toHaveBeenCalledTimes(1);
      expect(reader.findUserBindings).toHaveBeenCalledTimes(1);
    });

    /** @scenario "An organization permission held only at the organization answers yes on a project page" */
    it("holds members:view at the organization and not on the project", async () => {
      const { authz } = liteMemberWithNoProjectGrant();

      const { permissions, organizationPermissions } =
        await authz.effectivePermissionsWithOrganization({
          principal: LITE_MEMBER,
          scope: PROJECT_SCOPE,
        });

      expect(organizationPermissions).toContain("members:view");
      expect(organizationPermissions).toContain("organization:view");
      expect(permissions).not.toContain("members:view");
    });
  });

  describe("when the scope asked is the organization itself", () => {
    /** @scenario "The project page's one grant read carries the organization's permissions too" */
    it("answers the same set twice from one snapshot load", async () => {
      const collect = vi.spyOn(AuthzGrantSnapshotService.prototype, "collectWithOwnerCeiling");
      const { authz } = liteMemberWithNoProjectGrant();

      const { permissions, organizationPermissions } =
        await authz.effectivePermissionsWithOrganization({
          principal: LITE_MEMBER,
          scope: { type: "organization", id: ORG },
        });

      expect(collect).toHaveBeenCalledTimes(1);
      expect(organizationPermissions).toEqual(permissions);
      expect(permissions).toContain("members:view");
    });
  });
});

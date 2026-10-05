// Asserted on `code` and `meta`, never on the sentence: a route once told a
// 403 from a 500 by comparing that sentence word for word, which is exactly
// what this shape exists to stop.

/**
 * A project permission denial: knowable and actionable — ask an admin for the
 * permission `meta` names — so a handled error, not a bare `Error`.
 * Spec: specs/errors/handled-error-surfaces.feature
 */
import { describe, expect, it, vi } from "vitest";

import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub.ts";
import { StubAuthzManagedGrantRepository } from "../../repositories/__tests__/support/authz-managed-grant.stub.ts";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub.ts";
import { AuthzService } from "../authz.service.ts";

const PROJECT = { projectId: "proj-1", teamId: "team-1", organizationId: "org-1" };

/** The project exists and the user holds no binding anywhere on it. */
function authzWithNoBindings() {
  return AuthzService.create({
    isOnEngine: async () => true,
    repository: makeReader({
      findProjectLineage: vi.fn().mockResolvedValue(PROJECT),
    }),
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzManagedGrantRepository(),
  });
}

/** A Developer whose only binding is the organization-wide one the seat never honours. */
function authzForDeveloperWithOrganizationBinding() {
  return AuthzService.create({
    isOnEngine: async () => true,
    repository: makeReader({
      findProjectLineage: vi.fn().mockResolvedValue(PROJECT),
      findOrganizationMembership: vi.fn().mockResolvedValue({ role: "DEVELOPER", disabled: false }),
      findUserBindings: vi
        .fn()
        .mockResolvedValue([
          { roleKey: "admin", scopeType: "ORGANIZATION", scopeId: PROJECT.organizationId },
        ]),
    }),
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzManagedGrantRepository(),
  });
}

describe("AuthzService.authorizeProjectPermission", () => {
  describe("given a Developer asking for a shared project", () => {
    /** @scenario A Developer never sees a shared project */
    it("refuses with the Developer seat's own code, naming the resource", async () => {
      await expect(
        authzForDeveloperWithOrganizationBinding().authorizeProjectPermission({
          userId: "developer-1",
          projectId: PROJECT.projectId,
          permission: "traces:view",
        }),
      ).rejects.toMatchObject({
        code: "developer_seat_restricted",
        httpStatus: 401,
        meta: { resource: "traces" },
      });
    });
  });

  describe("given a user without the required permission on a project", () => {
    /** @scenario "A project permission denial names itself" */
    it("refuses with a code, the customer's fault, and the permission", async () => {
      await expect(
        authzWithNoBindings().authorizeProjectPermission({
          userId: "user-not-a-member",
          projectId: PROJECT.projectId,
          permission: "traces:view",
        }),
      ).rejects.toMatchObject({
        code: "project_permission_denied",
        httpStatus: 403,
        fault: "customer",
        meta: { permission: "traces:view" },
      });
    });
  });
});

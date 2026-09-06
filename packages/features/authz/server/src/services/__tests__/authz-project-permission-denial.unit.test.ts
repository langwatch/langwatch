// Asserted on `code` and `meta`, never on the sentence: a route once told a
// 403 from a 500 by comparing that sentence word for word, which is exactly
// what this shape exists to stop.

/**
 * A project permission denial: knowable and actionable — ask an admin for the
 * permission `meta` names — so a handled error, not a bare `Error`.
 * Spec: specs/errors/handled-error-surfaces.feature
 */
import { describe, expect, it, vi } from "vitest";

import { StubAuthzBindingRepository } from "../../repositories/__tests__/support/authz-binding.stub";
import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub";
import { AuthzService } from "../authz.service";

const PROJECT = { projectId: "proj-1", teamId: "team-1", organizationId: "org-1" };

/** The project exists and the user holds no binding anywhere on it. */
function authzWithNoBindings() {
  return AuthzService.create({
    isOnEngine: async () => true,
    repository: makeReader({
      tryFindProjectLineage: vi.fn().mockResolvedValue(PROJECT),
    }),
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzBindingRepository(),
  });
}

describe("AuthzService.authorizeProjectPermission", () => {
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

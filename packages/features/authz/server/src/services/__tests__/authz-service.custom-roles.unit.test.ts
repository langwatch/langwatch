import { describe, expect, it, vi } from "vitest";
import { AuthzService } from "../authz.service";
import { StubAuthzBindingRepository } from "../../repositories/__tests__/support/authz-binding.stub";
import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub";

const ORG = "org-123";

function makeService({ listing = new StubAuthzListingRepository() } = {}) {
  return AuthzService.create({
    isOnEngine: async () => true,
    repository: makeReader(),
    listing,
    bindings: new StubAuthzBindingRepository(),
  });
}

describe("AuthzService custom role listing", () => {
  describe("when the organization is not on an Enterprise plan", () => {
    /** @scenario "Non-enterprise org can list custom roles" */
    it("still returns the custom roles created while it was on Enterprise", async () => {
      const mockRoles = [
        {
          id: "role-1",
          name: "Data Analyst",
          description: "Can view analytics and datasets",
          permissions: ["analytics:view", "datasets:view"],
          organizationId: ORG,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "role-2",
          name: "Experiment Manager",
          description: "Can manage experiments",
          permissions: ["workflows:manage"],
          organizationId: ORG,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const listing = new StubAuthzListingRepository();
      listing.findUserCreatedRoles.mockResolvedValue(mockRoles);

      const service = makeService({ listing });

      // Enterprise-plan gating on custom-role reads happens above this
      // service, at the router boundary — the read-only listing itself is
      // never plan-gated, so the service answers regardless of plan.
      const result = await service.listUserCreatedRoles({ organizationId: ORG });

      expect(result).toEqual(mockRoles);
      expect(listing.findUserCreatedRoles).toHaveBeenCalledWith({ organizationId: ORG });
    });
  });
});

/**
 * The liveness check onLiveOrganization relies on: `getWithAdministrators` over the memory
 * stores refuses a deleted organization by code.
 * @see modules/organization/specs/organization-service.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { TestAuthzApi } from "../../transport/__tests__/support/test-authz-api.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-1";

describe("given an organization that was deleted", () => {
  describe("when its administrators are read", () => {
    /** @scenario "Refuses an unknown organization by code" */
    it("throws organization_not_found", async () => {
      const permissions = TestAuthzApi.create({
        people: [{ id: "user-admin", name: "Ana", email: "ana@acme.test" }],
      });
      const memory = MemoryOrganizationDatabase.create();
      const setup = organizationModuleSetup({ permissions, memory });
      await setup.repositories.membership(permissions).createAndAssign({
        userId: "user-admin",
        orgId: ORGANIZATION_ID,
        orgName: "ACME",
        orgSlug: "acme",
        teamId: "team-1",
        teamSlug: "engineering",
        pricingModel: "SEAT_EVENT",
      });
      const app = await OrganizationModule.create(setup);
      await app.deleteProvisionedOrganization({ organizationId: ORGANIZATION_ID });

      await expect(
        app.getWithAdministrators({ organizationId: ORGANIZATION_ID }),
      ).rejects.toMatchObject({ code: "organization_not_found" });
    });
  });
});

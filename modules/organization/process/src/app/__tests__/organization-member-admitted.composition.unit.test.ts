/**
 * A membership created outside an invite is recorded as an admission for peers such as nurturing.
 * @see modules/organization/specs/organization-service.feature
 */
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { TestAuthzApi } from "../../transport/__tests__/support/test-authz-api.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-1";

const roomyPlan: Plan = {
  planSource: "free",
  type: "free",
  name: "Free",
  free: true,
  maxMembers: 1_000_000,
  maxMembersLite: 1_000_000,
  maxMembersDeveloper: 0,
  maxMessagesPerMonth: 1_000_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
};

/** An organization whose administrator holds a seat, with `member_admitted` facts collected. */
async function organizationWith(plan: Plan) {
  const permissions = TestAuthzApi.create({
    people: [
      { id: "user-admin", name: "Ana", email: "ana@acme.test" },
      { id: "user-ben", name: "Ben", email: "ben@acme.test" },
    ],
  });
  const memory = MemoryOrganizationDatabase.create();
  const setup = organizationModuleSetup({
    permissions,
    memory,
    entitlement: createApiFixture<EntitlementApi>(
      { getActivePlan: async () => plan, requestBound: async () => 1_000 },
      "EntitlementApi",
    ),
  });
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
  const admitted: unknown[] = [];
  const accepts = { send: async () => undefined };
  app.connectLifecycle({
    recordCreated: accepts,
    recordSignedUp: accepts,
    recordMembersInvited: accepts,
    recordInviteAccepted: accepts,
    recordIntegrationMethodChosen: accepts,
    recordPersonalWorkspaceProvisioned: accepts,
    recordPersonalTeamCreated: accepts,
    recordPersonalWorkspaceArchived: accepts,
    recordPersonalWorkspaceRevived: accepts,
    recordPersonalWorkspaceFeaturesChanged: accepts,
    recordPresenceSettingChanged: { ...accepts, sendBatch: async () => undefined },
    recordTraceSharingDisabled: accepts,
    recordDocsPlaygroundSessionsDisabled: accepts,
    recordMemberDisabled: accepts,
    recordMemberEnabled: accepts,
    recordMemberRemoved: accepts,
    recordMemberDepartmentChanged: accepts,
    recordMemberRoleChanged: accepts,
    recordMemberAdmitted: { send: async (data: unknown) => void admitted.push(data) },
  });
  return { app, admitted };
}

describe("given an organization with an administrator", () => {
  describe("when a membership is created for somebody new", () => {
    /** @scenario "A membership created outside an invite records the member as admitted" */
    it("records them as admitted, with their seat and the path", async () => {
      const { app, admitted } = await organizationWith(roomyPlan);

      await app.createMembership({ organizationId: ORGANIZATION_ID, userId: "user-ben" });

      await vi.waitFor(() =>
        expect(admitted).toEqual([
          expect.objectContaining({
            organizationId: ORGANIZATION_ID,
            userId: "user-ben",
            role: "MEMBER",
            via: "create_membership",
          }),
        ]),
      );
    });
  });

  describe("when a membership is created for somebody who is already a member", () => {
    /** @scenario "A membership created outside an invite records the member as admitted" */
    it("records nothing for the repeat call", async () => {
      const { app, admitted } = await organizationWith(roomyPlan);
      await app.createMembership({ organizationId: ORGANIZATION_ID, userId: "user-ben" });
      await vi.waitFor(() => expect(admitted).toHaveLength(1));

      const repeat = await app.createMembership({
        organizationId: ORGANIZATION_ID,
        userId: "user-ben",
      });

      expect(repeat.outcome).toBe("already-present");
      // Lifecycle sends are fire-and-forget; give a wrongly sent one time to land.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(admitted).toHaveLength(1);
    });
  });

  describe("when a membership is created with no seat free", () => {
    /** @scenario "A membership created outside an invite records the member as admitted" */
    it("leaves them waiting and records nothing", async () => {
      // The administrator holds the only full seat and the plan has no Lite seats.
      const { app, admitted } = await organizationWith({
        ...roomyPlan,
        maxMembers: 1,
        maxMembersLite: 0,
      });

      const admission = await app.createMembership({
        organizationId: ORGANIZATION_ID,
        userId: "user-ben",
      });

      expect(admission.pending).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(admitted).toEqual([]);
    });
  });
});

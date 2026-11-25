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
/** A second organization, always roomy, whose admissions mark the lifecycle queue as drained. */
const ELSEWHERE_ID = "org-2";

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

type Admitted = { organizationId: string };

/**
 * An organization on `plan` whose administrator holds a seat, beside a roomy one she also
 * administers, with `member_admitted` facts collected.
 */
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
      {
        getActivePlan: async ({ organizationId }) =>
          organizationId === ORGANIZATION_ID ? plan : roomyPlan,
        requestBound: async () => 1_000,
      },
      "EntitlementApi",
    ),
  });
  const memberships = setup.repositories.membership(permissions);
  await memberships.createAndAssign({
    userId: "user-admin",
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: "team-1",
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  await memberships.createAndAssign({
    userId: "user-admin",
    orgId: ELSEWHERE_ID,
    orgName: "Elsewhere",
    orgSlug: "elsewhere",
    teamId: "team-2",
    teamSlug: "research",
    pricingModel: "SEAT_EVENT",
  });
  const app = await OrganizationModule.create(setup);
  const admitted: Admitted[] = [];
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
    recordMemberAdmitted: { send: async (data: Admitted) => void admitted.push(data) },
  });
  return { app, admitted };
}

/**
 * What was recorded for the first organization once every earlier lifecycle send has landed.
 * Sends leave in call order, so Ben's admission elsewhere arriving means any send made
 * before it has arrived too: a negative check needs no sleep.
 */
async function recordedOnceDrained(
  app: Awaited<ReturnType<typeof organizationWith>>["app"],
  admitted: Admitted[],
) {
  await app.createMembership({ organizationId: ELSEWHERE_ID, userId: "user-ben" });
  await vi.waitFor(() =>
    expect(admitted).toContainEqual(expect.objectContaining({ organizationId: ELSEWHERE_ID })),
  );
  return admitted.filter((record) => record.organizationId === ORGANIZATION_ID);
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
      expect(await recordedOnceDrained(app, admitted)).toHaveLength(1);
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
      expect(await recordedOnceDrained(app, admitted)).toEqual([]);
    });
  });
});

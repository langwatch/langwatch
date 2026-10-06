/**
 * Invitations by their stored shape and their matching, through `OrganizationModule.create`
 * over the memory registry.
 * @see specs/identity/resilient-invitations.feature
 */
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { IdentityApi, MatchableEmail } from "@langwatch/identity-contract";
import type { OrganizationCaller } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { TestAuthzApi } from "../../transport/__tests__/support/test-authz-api.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-1";
const TEAM_ID = "team-1";
const ADMIN: OrganizationCaller = { id: "user-admin", email: "ana@acme.test" };

const roomyPlan: Plan = {
  planSource: "free",
  type: "free",
  name: "Free",
  free: true,
  maxMembers: 1_000_000,
  maxMembersLite: 1_000_000,
  maxMessagesPerMonth: 1_000_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
};

/** The proven addresses `identity` answers for a person, by user id. */
type ProvenAddresses = Record<string, MatchableEmail[]>;

/**
 * The application over memory repositories holding one organization, its one team and its
 * administrator, in which `proven` is what identity vouches for per person.
 */
async function application({ proven = {} }: { proven?: ProvenAddresses } = {}) {
  const permissions = TestAuthzApi.create({
    people: [
      { id: ADMIN.id, name: "Ana", email: ADMIN.email! },
      { id: "user-sam", name: "Sam", email: "sam@home.test" },
    ],
  });
  permissions.findPermissionsBeyondCaller = async () => [];
  permissions.invalidateOrganization = async () => {};
  permissions.revokeBindingsWhere = async () => 0;
  const setup = organizationModuleSetup({
    permissions,
    entitlement: createApiFixture<EntitlementApi>(
      { getActivePlan: async () => roomyPlan, requestBound: async () => 1_000 },
      "EntitlementApi",
    ),
    identity: createApiFixture<IdentityApi>(
      {
        verifiedEmailsOf: async ({ userId }) =>
          proven[userId] ? { kind: "resolved", emails: proven[userId] } : { kind: "keep_legacy" },
      },
      "IdentityApi",
    ),
  });
  await setup.repositories.membership(permissions).createAndAssign({
    userId: ADMIN.id,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: TEAM_ID,
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  const app = await OrganizationModule.create(setup);

  return { app, setup };
}

describe("given an administrator of an organization with one team", () => {
  describe("when an external member is invited without naming a team", () => {
    /** @scenario "Teamless external invitations are refused" */
    it("creates no invitation", async () => {
      const { app } = await application();

      const created = await app.createInvitations(
        {
          organizationId: ORGANIZATION_ID,
          validation: "strict",
          invites: [{ email: "guest@partner.test", role: "EXTERNAL" }],
        },
        ADMIN,
      );
      const listed = await app.listPendingInvitations({ organizationId: ORGANIZATION_ID });

      expect(created).toEqual([]);
      expect(listed).toHaveLength(0);
    });
  });
});

describe("given somebody who holds more than one proven address", () => {
  const SAM = { id: "user-sam", name: "Sam", email: "sam@home.test" };
  const proven: ProvenAddresses = {
    [SAM.id]: [
      { identifierId: "idf_home", value: "sam@home.test", provider: "google" },
      { identifierId: "idf_work", value: "sam@acme.test", provider: "email" },
    ],
  };

  describe("when an invitation is sent to one of them and Sam signs in with the other", () => {
    /** @scenario "An invitation reaches the person, not the address" */
    it("matches Sam, and accepting joins Sam's own account to the organization", async () => {
      const { app } = await application({ proven });
      const [{ invite }] = (await app.createInvitations(
        {
          organizationId: ORGANIZATION_ID,
          validation: "strict",
          invites: [
            {
              email: "sam@acme.test",
              role: "MEMBER",
              teams: [{ teamId: TEAM_ID, role: "MEMBER" }],
            },
          ],
        },
        ADMIN,
      )) as [Awaited<ReturnType<typeof app.createInvitations>>[number]];

      const accepted = await app.acceptInvitation({ inviteCode: invite.inviteCode }, SAM);

      expect(accepted.success).toBe(true);
      expect(await app.organizationIdsForMember({ userId: SAM.id })).toContain(ORGANIZATION_ID);
    });
  });

  describe("when the invitation is sent to an address nobody on that account has proven", () => {
    it("is refused as the wrong account and Sam joins nothing", async () => {
      const { app } = await application({ proven });
      const [{ invite }] = (await app.createInvitations(
        {
          organizationId: ORGANIZATION_ID,
          validation: "strict",
          invites: [
            {
              email: "other@acme.test",
              role: "MEMBER",
              teams: [{ teamId: TEAM_ID, role: "MEMBER" }],
            },
          ],
        },
        ADMIN,
      )) as [Awaited<ReturnType<typeof app.createInvitations>>[number]];

      await expect(
        app.acceptInvitation({ inviteCode: invite.inviteCode }, SAM),
      ).rejects.toMatchObject({ code: "invite_wrong_account" });
      expect(await app.organizationIdsForMember({ userId: SAM.id })).not.toContain(ORGANIZATION_ID);
    });
  });
});

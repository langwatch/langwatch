/**
 * @vitest-environment node
 *
 * What the application still does once the plan is declared on the doors
 * (transport/__tests__/custom-role-gate and audit-group-gate declaration tests).
 * @see specs/features/enterprise-feature-guards.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationCaller } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { TestAuthzApi } from "../../transport/__tests__/support/test-authz-api.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-1";
const TEAM_ID = "team-1";
const CALLER: OrganizationCaller = { id: "user-1", email: "sam@acme.test" };
const COLLEAGUE_ID = "u1";

/** The application over memory repositories holding one organization, its team and two members. */
async function application() {
  const ledger = TestAuthzApi.create({
    people: [
      { id: CALLER.id, name: "Sam", email: "sam@acme.test" },
      { id: COLLEAGUE_ID, name: "Ana", email: "ana@acme.test" },
    ],
  });
  // The caller holds everything the change confers, so the grant ceiling lets it through.
  const permissions = createApiFixture<AuthzApi>(
    {
      listScopeBindings: (args) => ledger.listScopeBindings(args),
      attachBindings: (args) => ledger.attachBindings(args),
      revokeBindings: (args) => ledger.revokeBindings(args),
      findPermissionsBeyondCaller: async () => [],
    },
    "AuthzApi",
  );
  const setup = organizationModuleSetup({ permissions });
  const membership = setup.repositories.membership(permissions);
  await membership.createAndAssign({
    userId: CALLER.id,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: TEAM_ID,
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  await membership.createMembership({
    organizationId: ORGANIZATION_ID,
    userId: COLLEAGUE_ID,
    pendingAdmissionId: "admission-1",
    via: "invite",
  });
  ledger.seedTeamBinding({
    id: "binding-caller",
    organizationId: ORGANIZATION_ID,
    teamId: TEAM_ID,
    userId: CALLER.id,
    role: "ADMIN",
  });

  return { app: await OrganizationModule.create(setup), ledger };
}

describe("given a team member list that names only built-in roles", () => {
  describe("when the team settings form is saved", () => {
    /** @scenario "Non-enterprise org can update team members with built-in roles" */
    it("writes the change and attributes it to the caller", async () => {
      const { app, ledger } = await application();

      await app.updateTeamMembers(
        {
          teamId: TEAM_ID,
          name: "Engineering",
          members: [
            { userId: CALLER.id, role: "ADMIN" },
            { userId: COLLEAGUE_ID, role: "MEMBER" },
          ],
        },
        CALLER,
      );

      expect(ledger.teamMemberIds(TEAM_ID)).toEqual([CALLER.id, COLLEAGUE_ID]);
      expect(ledger.attachCallers).toEqual([{ type: "user", id: CALLER.id }]);
    });
  });
});

describe("given the audit trail is read", () => {
  describe("when the trail is read", () => {
    /** @scenario "Enterprise org can access audit logs" */
    it("answers with the trail", async () => {
      const { app } = await application();

      await expect(
        app.readAuditLogs({ organizationId: ORGANIZATION_ID, pageOffset: 0, pageSize: 50 }, CALLER),
      ).resolves.toEqual({ auditLogs: [], totalCount: 0 });
    });
  });
});

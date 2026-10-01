import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 *
 * What the application still does once the plan is declared on the doors
 * (transport/__tests__/custom-role-gate and audit-group-gate declaration tests).
 * @see specs/features/enterprise-feature-guards.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationCaller } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import { type ServerOrganizationAppDependencies } from "../organization.app.ts";
import { organizationAppForTesting } from "./support/organization-app-for-testing.ts";

const ORGANIZATION_ID = "org-1";
const TEAM = {
  id: "team-1",
  name: "Engineering",
  slug: "engineering",
  organizationId: ORGANIZATION_ID,
  isPersonal: false,
  ownerUserId: null,
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const CALLER: OrganizationCaller = { id: "user-1", name: "Sam", email: "sam@acme.test" };

function application() {
  const writes = {
    updateTeamWithMembers: vi.fn(async () => undefined),
    getAuditLogs: vi.fn(async () => ({ auditLogs: [], totalCount: 0 })),
  };

  const organizations = {
    getTeamById: vi.fn(async () => TEAM),
    updateTeamWithMembers: writes.updateTeamWithMembers,
    getOrganizationIdByTeamId: vi.fn(async () => ORGANIZATION_ID),
  };

  const membership = {
    getAuditLogs: writes.getAuditLogs,
    findUserOrgRoleByTeamId: vi.fn(async () => "MEMBER" as const),
  };

  const app = organizationAppForTesting({
    dependencies: {
      organizations:
        createApiFixture<ServerOrganizationAppDependencies["organizations"]>(organizations),
      membership: createApiFixture<ServerOrganizationAppDependencies["membership"]>(membership),
      projects: createApiFixture<ServerOrganizationAppDependencies["projects"]>(),
      permissions: createApiFixture<AuthzApi>({ hasPermission: vi.fn(async () => true) }),
    },
  });

  return { app, ...writes };
}

describe("given a team member list that names only built-in roles", () => {
  describe("when the team settings form is saved", () => {
    /** @scenario "Non-enterprise org can update team members with built-in roles" */
    it("writes the change and attributes it to the caller", async () => {
      const { app, updateTeamWithMembers } = application();

      await app.updateTeamMembers(
        { teamId: TEAM.id, name: "Engineering", members: [{ userId: "u1", role: "ADMIN" }] },
        CALLER,
      );

      expect(updateTeamWithMembers).toHaveBeenCalledWith({
        teamId: TEAM.id,
        name: "Engineering",
        members: [{ userId: "u1", role: "ADMIN" }],
        caller: { type: "user", id: CALLER.id },
        actor: { type: "user", id: CALLER.id },
      });
    });
  });
});

describe("given the audit trail is read", () => {
  describe("when the trail is read", () => {
    it("answers with the trail", async () => {
      const { app, getAuditLogs } = application();

      await expect(
        app.readAuditLogs({ organizationId: ORGANIZATION_ID, pageOffset: 0, pageSize: 50 }, CALLER),
      ).resolves.toEqual({ auditLogs: [], totalCount: 0 });

      expect(getAuditLogs).toHaveBeenCalled();
    });
  });
});

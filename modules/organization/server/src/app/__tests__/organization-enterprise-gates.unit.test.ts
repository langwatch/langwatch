/**
 * @vitest-environment node
 *
 * The three Enterprise capabilities the organization application gates: a
 * custom team role on a team's member list, a custom team role on one member's
 * role change, and the audit trail. Each is asked BEFORE the write or the
 * query, so a deployment without the plan changes nothing and reads nothing.
 *
 * The gates used to live in the `organization.*` and `team.*` tRPC transports.
 * They are the application's now, and this drives them there.
 *
 * @see specs/features/enterprise-feature-guards.feature
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationCaller } from "@langwatch/organization-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationPlanGate } from "../organization.infrastructure.ts";
import { ServerOrganizationApp, type ServerOrganizationAppDependencies } from "../organization.app.ts";

const ORGANIZATION_ID = "org-1";
const TEAM = { id: "team-1", name: "Engineering", slug: "engineering", organizationId: ORGANIZATION_ID };
const CALLER: OrganizationCaller = { id: "user-1", name: "Sam", email: "sam@acme.test" };

/** The refusal a deployment without the capability answers with. */
class CapabilityUnavailableError extends HandledError {
  constructor(message: string) {
    super("permission_denied", message, { httpStatus: 403, fault: "customer" });
    this.name = "CapabilityUnavailableError";
  }
}

/** No personal workspace is in scope, which is what the role change checks first. */
function testPrisma() {
  return {
    team: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient;
}

function application(options: { enterprise: boolean }) {
  const writes = {
    updateTeamWithMembers: vi.fn(async () => undefined),
    createTeamWithMembers: vi.fn(async () => TEAM),
    updateTeamMemberRole: vi.fn(async () => undefined),
    getAuditLogs: vi.fn(async () => ({ auditLogs: [], totalCount: 0 })),
  };

  const refuse = (capability: string) => async () => {
    if (!options.enterprise) throw new CapabilityUnavailableError(capability);
  };

  const plans = {
    assertCustomRolesAllowed: vi.fn(refuse("Custom roles require an Enterprise plan")),
    assertAuditLogsAllowed: vi.fn(refuse("Audit logs require an Enterprise plan")),
    assertScimAllowed: vi.fn(async () => undefined),
    assertTeamRoleChangeWithinSeatLimits: vi.fn(async () => undefined),
  } as unknown as OrganizationPlanGate;

  const organizations = {
    getTeamById: vi.fn(async () => TEAM),
    createTeamWithMembers: writes.createTeamWithMembers,
    updateTeamWithMembers: writes.updateTeamWithMembers,
    tryGetOrganizationIdByTeamId: vi.fn(async () => ORGANIZATION_ID),
  };

  const membership = {
    updateTeamMemberRole: writes.updateTeamMemberRole,
    getAuditLogs: writes.getAuditLogs,
    tryGetUserOrgRoleByTeamId: vi.fn(async () => "MEMBER"),
  };

  const app = ServerOrganizationApp.createForTesting({
    dependencies: {
      organizations: organizations as unknown as ServerOrganizationAppDependencies["organizations"],
      membership: membership as unknown as ServerOrganizationAppDependencies["membership"],
      projects: {} as unknown as ServerOrganizationAppDependencies["projects"],
      permissions: { hasPermission: vi.fn(async () => true) } as unknown as AuthzApi,
    },
    infrastructure: { plans, database: testPrisma() },
  });

  return { app, plans, ...writes };
}

describe("given a team member list that names a custom role", () => {
  describe("when the plan does not carry custom roles", () => {
    /** @scenario "Non-enterprise org cannot assign custom roles via team update" */
    it("refuses the team update before any write", async () => {
      const { app, updateTeamWithMembers } = application({ enterprise: false });

      await expect(
        app.updateTeamMembers(
          {
            teamId: TEAM.id,
            name: "Engineering",
            members: [{ userId: "u1", role: "custom:auditor", customRoleId: "role-1" }],
          },
          CALLER,
        ),
      ).rejects.toMatchObject({ code: "permission_denied" });

      expect(updateTeamWithMembers).not.toHaveBeenCalled();
    });

    /** @scenario "Non-enterprise org cannot create teams with custom role members" */
    it("refuses the team creation before any write", async () => {
      const { app, createTeamWithMembers } = application({ enterprise: false });

      await expect(
        app.createTeamWithGatedMembers(
          {
            organizationId: ORGANIZATION_ID,
            name: "Engineering",
            members: [{ userId: "u1", role: "custom:auditor", customRoleId: "role-1" }],
          },
          CALLER,
        ),
      ).rejects.toMatchObject({ code: "permission_denied" });

      expect(createTeamWithMembers).not.toHaveBeenCalled();
    });
  });
});

describe("given a team member list that names only built-in roles", () => {
  describe("when the team settings form is saved", () => {
    /** @scenario "Non-enterprise org can update team members with built-in roles" */
    it("writes the change and attributes it to the caller", async () => {
      const { app, updateTeamWithMembers, plans } = application({ enterprise: false });

      await app.updateTeamMembers(
        { teamId: TEAM.id, name: "Engineering", members: [{ userId: "u1", role: "ADMIN" }] },
        CALLER,
      );

      expect(plans.assertCustomRolesAllowed).not.toHaveBeenCalled();
      expect(updateTeamWithMembers).toHaveBeenCalledWith({
        teamId: TEAM.id,
        name: "Engineering",
        members: [{ userId: "u1", role: "ADMIN" }],
        actor: { type: "user", id: CALLER.id },
      });
    });
  });
});

describe("given one member's team role is changed to a custom one", () => {
  describe("when the plan does not carry custom roles", () => {
    /** @scenario "Non-enterprise org cannot update team member role to custom role" */
    it("refuses before the change is written", async () => {
      const { app, updateTeamMemberRole } = application({ enterprise: false });

      await expect(
        app.changeTeamMemberRole(
          { teamId: TEAM.id, userId: "u2", role: "custom:role-1", customRoleId: "role-1" },
          CALLER,
        ),
      ).rejects.toMatchObject({ code: "permission_denied" });

      expect(updateTeamMemberRole).not.toHaveBeenCalled();
    });
  });
});

describe("given the audit trail is read", () => {
  describe("when the plan does not carry audit logs", () => {
    /** @scenario "Non-enterprise org cannot access audit logs" */
    it("refuses before the query runs", async () => {
      const { app, getAuditLogs } = application({ enterprise: false });

      await expect(
        app.readAuditLogs({ organizationId: ORGANIZATION_ID }, CALLER),
      ).rejects.toMatchObject({ code: "permission_denied" });

      expect(getAuditLogs).not.toHaveBeenCalled();
    });
  });

  describe("when the plan carries audit logs", () => {
    /** @scenario "Enterprise org can access audit logs" */
    it("answers with the trail", async () => {
      const { app, getAuditLogs } = application({ enterprise: true });

      await expect(
        app.readAuditLogs({ organizationId: ORGANIZATION_ID }, CALLER),
      ).resolves.toEqual({ auditLogs: [], totalCount: 0 });

      expect(getAuditLogs).toHaveBeenCalled();
    });
  });
});

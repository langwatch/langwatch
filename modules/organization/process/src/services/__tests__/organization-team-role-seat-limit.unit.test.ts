/**
 * The seat guard on a Lite Member's team-role change, as main's organization.ts:699-730 ran it.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import { TeamUserRole } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationSeatLicense } from "../../app/organization.members.ts";
import type { OrganizationMembershipRepository } from "../../repositories/organization-membership.repository.ts";
import { OrganizationMembershipService } from "../organization-membership.service.ts";

const TARGET = { organizationId: "org-1", teamId: "team-1", userId: "user-2" };

function serviceWhere(options: {
  customRolePermissions: unknown[];
  assertRoleChangeAllowed: OrganizationSeatLicense["assertRoleChangeAllowed"];
}) {
  const findTeamGrants = vi.fn(async () =>
    options.customRolePermissions.length > 0
      ? [{ scopeId: TARGET.teamId, role: TeamUserRole.CUSTOM, customRoleId: "role-1" }]
      : [{ scopeId: TARGET.teamId, role: TeamUserRole.VIEWER, customRoleId: null }],
  );
  const findCustomRolePermissions = vi.fn(async () => options.customRolePermissions);
  const assertRoleChangeAllowed = vi.fn(options.assertRoleChangeAllowed);
  const service = OrganizationMembershipService.create({
    repository: createApiFixture<OrganizationMembershipRepository>({
      findTeamGrants,
      findCustomRolePermissions,
    }),
    prompts: { seedTagsForOrganization: vi.fn(), reportCompensationFailure: vi.fn() },
    seats: { checkLimit: vi.fn(), assertRoleChangeAllowed },
    sessions: { revokeAllBrowserSessions: vi.fn() },
    grantCache: { invalidateOrganization: vi.fn() },
    testArrivals: { standingFor: async (): Promise<{ testing: false }> => ({ testing: false }) },
    ceiling: { assertWithinCaller: async () => {} },
    admissions: { attachBindings: vi.fn(), completeAdmission: vi.fn() },
  });

  return { service, assertRoleChangeAllowed, findTeamGrants };
}

describe("OrganizationMembershipService.assertTeamRoleChangeWithinSeatLimits", () => {
  describe("given the member holds a custom role granting more than viewing on the team", () => {
    /** @scenario "A Lite Member's team-role change is weighed against the seat their custom role held" */
    it("weighs the change from that role's permissions to a Lite Member seat", async () => {
      const { service, assertRoleChangeAllowed, findTeamGrants } = serviceWhere({
        customRolePermissions: [["traces:view", "traces:manage"]],
        assertRoleChangeAllowed: async () => undefined,
      });

      await service.assertTeamRoleChangeWithinSeatLimits(TARGET);

      expect(findTeamGrants).toHaveBeenCalledWith({
        organizationId: "org-1",
        userId: "user-2",
        teamIds: ["team-1"],
      });
      expect(assertRoleChangeAllowed).toHaveBeenCalledWith({
        organizationId: "org-1",
        currentRole: "EXTERNAL",
        userPermissions: ["traces:view", "traces:manage"],
        role: "EXTERNAL",
      });
    });

    /** @scenario "A Lite Member's team-role change is refused when no Lite Member seat is left" */
    it("refuses with the seat licence's limit error", async () => {
      const { service } = serviceWhere({
        customRolePermissions: [["traces:manage"]],
        assertRoleChangeAllowed: async () => {
          throw new LimitExceededError("membersLite", 2, 2);
        },
      });

      await expect(service.assertTeamRoleChangeWithinSeatLimits(TARGET)).rejects.toMatchObject({
        code: "resource_limit_exceeded",
      });
    });
  });

  describe("given the member holds no custom role on the team", () => {
    it("weighs the change with no permissions, which costs no seat", async () => {
      const { service, assertRoleChangeAllowed } = serviceWhere({
        customRolePermissions: [],
        assertRoleChangeAllowed: async () => undefined,
      });

      await service.assertTeamRoleChangeWithinSeatLimits(TARGET);

      expect(assertRoleChangeAllowed).toHaveBeenCalledWith(
        expect.objectContaining({ userPermissions: undefined }),
      );
    });
  });
});

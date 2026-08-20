import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { resetAuthzEngineGateForTesting } from "~/server/app-layer/authz/engine-gate";
import { PrismaRoleBindingRepository } from "../repositories/role-binding.prisma.repository";

/** These reads now go through the per-organization fork, so the double has to
 *  answer the gate. Without it the gate's read throws, the gate fail-safes to
 *  the legacy head, and the assertions below pass on a swallowed exception
 *  rather than on a head this test chose. */
const legacyPrisma = (roleBindingFindMany: ReturnType<typeof vi.fn>) =>
  ({
    roleBinding: { findMany: roleBindingFindMany },
    systemMigrationTenantState: {
      findUnique: vi
        .fn()
        .mockResolvedValue(null),
    },
  }) as unknown as PrismaClient;

describe("PrismaRoleBindingRepository tenant references", () => {
  afterEach(() => {
    resetAuthzEngineGateForTesting();
  });

  it("drops a group binding whose group belongs to another organization", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        organizationId: "org_1",
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: "team_1",
        role: TeamUserRole.MEMBER,
        customRoleId: null,
        customRole: null,
        group: { organizationId: "org_2" },
      },
    ]);
    const repository = new PrismaRoleBindingRepository(legacyPrisma(findMany));

    const bindings = await repository.listForOrganizationsAndUser({
      orgIds: ["org_1", "org_2"],
      userId: "user_1",
    });

    expect(bindings).toEqual([]);
  });

  it("requires team binding users to belong to the organization", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaRoleBindingRepository(legacyPrisma(findMany));

    await repository.listTeamScopedUserBindingsByTeamIds({
      organizationId: "org_1",
      teamIds: ["team_1"],
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: {
            orgMemberships: { some: { organizationId: "org_1" } },
          },
        }),
      }),
    );
  });
});

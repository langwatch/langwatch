import {
  RoleBindingScopeType,
  TeamUserRole,
  type PrismaClient,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaRoleBindingRepository } from "../repositories/role-binding.prisma.repository";

describe("PrismaRoleBindingRepository tenant references", () => {
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
    const repository = new PrismaRoleBindingRepository({
      roleBinding: { findMany },
    } as unknown as PrismaClient);

    const bindings = await repository.listForOrganizationsAndUser({
      orgIds: ["org_1", "org_2"],
      userId: "user_1",
    });

    expect(bindings).toEqual([]);
  });

  it("requires team binding users to belong to the organization", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaRoleBindingRepository({
      roleBinding: { findMany },
    } as unknown as PrismaClient);

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

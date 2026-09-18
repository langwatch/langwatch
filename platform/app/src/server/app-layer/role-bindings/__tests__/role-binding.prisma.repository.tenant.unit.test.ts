import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { type Grant, PrismaClient } from "~/generated/prisma/client";
import { resetAuthzEngineGateForTesting } from "~/server/app-layer/authz/engine-gate";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import { PrismaRoleBindingRepository } from "../repositories/role-binding.prisma.repository";

const groupMembershipFindMany = vi.fn();
const prisma = Object.assign(
  new PrismaClient({
    adapter: createPrismaPgAdapter(
      "postgresql://localhost/unused_role_binding",
    ),
  }),
  { groupMembership: { findMany: groupMembershipFindMany } },
);
const grantFindMany = vi.spyOn(prisma.grant, "findMany").mockResolvedValue([]);
vi.spyOn(prisma.group, "findMany").mockResolvedValue([]);
vi.spyOn(prisma.user, "findMany").mockResolvedValue([]);
vi.spyOn(prisma.apiKey, "findMany").mockResolvedValue([]);
vi.spyOn(prisma.role, "findMany").mockResolvedValue([]);

function grant(overrides: Partial<Grant> = {}): Grant {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "grant_test",
    organizationId: "org_1",
    principalType: "GROUP",
    principalId: "group_1",
    roleKey: "member",
    legacyRole: "MEMBER",
    source: "migration",
    scopeType: "TEAM",
    scopeId: "team_1",
    token: null,
    permission: null,
    resourceKind: null,
    projectId: null,
    createdByUserId: null,
    expiresAt: null,
    maxViews: null,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PrismaRoleBindingRepository tenant references", () => {
  afterEach(() => {
    resetAuthzEngineGateForTesting();
    grantFindMany.mockReset();
    grantFindMany.mockResolvedValue([]);
    groupMembershipFindMany.mockReset();
    groupMembershipFindMany.mockResolvedValue([]);
  });

  it("drops a group binding whose group membership is outside the organization", async () => {
    groupMembershipFindMany.mockResolvedValue([
      { groupId: "group_foreign", group: { organizationId: "org_2" } },
    ]);
    grantFindMany.mockResolvedValue([
      grant({ id: "grant_foreign_group", principalId: "group_foreign" }),
    ]);
    const repository = new PrismaRoleBindingRepository(prisma);

    const bindings = await repository.listForOrganizationsAndUser({
      orgIds: ["org_1", "org_2"],
      userId: "user_1",
    });

    expect(bindings).toEqual([]);
    expect(groupMembershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_1",
          group: { organizationId: { in: ["org_1", "org_2"] } },
        },
      }),
    );
  });

  it("requires team binding users to belong to the organization", async () => {
    grantFindMany.mockResolvedValue([
      grant({
        id: "grant_user",
        principalType: "USER",
        principalId: "user_1",
      }),
    ]);
    const repository = new PrismaRoleBindingRepository(prisma);

    await repository.listTeamScopedUserBindingsByTeamIds({
      organizationId: "org_1",
      teamIds: ["team_1"],
    });

    expect(grantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org_1",
          revokedAt: null,
        }),
      }),
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["user_1"] },
          orgMemberships: { some: { organizationId: "org_1" } },
        }),
      }),
    );
  });
});

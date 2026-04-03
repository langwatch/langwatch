/**
 * @vitest-environment node
 *
 * Integration tests for migrateToRoleBindings task.
 */
import {
  RoleBindingScopeType,
  TeamUserRole,
  type Organization,
  type Team,
  type User,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { migrateTeamUsersToRoleBindings } from "../migrateToRoleBindings";

const NS = `migrate-rbac-${nanoid(6)}`;

describe("migrateTeamUsersToRoleBindings() integration", () => {
  let org: Organization;
  let team: Team;
  let alice: User;
  let bob: User;

  beforeAll(async () => {
    org = await prisma.organization.create({
      data: { name: `${NS}-org`, slug: `${NS}-org` },
    });
    team = await prisma.team.create({
      data: { name: `${NS}-team`, slug: `${NS}-team`, organizationId: org.id },
    });
    alice = await prisma.user.create({
      data: { name: "Alice", email: `${NS}-alice@test.com` },
    });
    bob = await prisma.user.create({
      data: { name: "Bob", email: `${NS}-bob@test.com` },
    });
    await prisma.organizationUser.createMany({
      data: [
        { userId: alice.id, organizationId: org.id, role: "MEMBER" },
        { userId: bob.id, organizationId: org.id, role: "MEMBER" },
      ],
    });
  });

  afterEach(async () => {
    await prisma.roleBinding.deleteMany({ where: { organizationId: org.id } });
    await prisma.teamUser.deleteMany({ where: { teamId: team.id } });
  });

  afterAll(async () => {
    await prisma.roleBinding.deleteMany({ where: { organizationId: org.id } });
    await prisma.teamUser.deleteMany({ where: { teamId: team.id } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: org.id } });
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
  });

  describe("when TeamUser records exist", () => {
    it("creates a TEAM-scoped RoleBinding for each TeamUser", async () => {
      await prisma.teamUser.createMany({
        data: [
          { userId: alice.id, teamId: team.id, role: TeamUserRole.MEMBER },
          { userId: bob.id, teamId: team.id, role: TeamUserRole.VIEWER },
        ],
      });

      const result = await migrateTeamUsersToRoleBindings({ prisma, organizationId: org.id });

      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);

      const bindings = await prisma.roleBinding.findMany({ where: { organizationId: org.id } });
      expect(bindings).toHaveLength(2);

      const aliceBinding = bindings.find((b) => b.userId === alice.id);
      const bobBinding = bindings.find((b) => b.userId === bob.id);

      expect(aliceBinding).toMatchObject({
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: team.id,
        role: TeamUserRole.MEMBER,
      });
      expect(bobBinding).toMatchObject({
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: team.id,
        role: TeamUserRole.VIEWER,
      });
    });

    it("skips rows that already have a RoleBinding", async () => {
      await prisma.teamUser.create({
        data: { userId: alice.id, teamId: team.id, role: TeamUserRole.ADMIN },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId: org.id,
          userId: alice.id,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: team.id,
        },
      });

      const result = await migrateTeamUsersToRoleBindings({ prisma, organizationId: org.id });

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
      expect(await prisma.roleBinding.count({ where: { organizationId: org.id } })).toBe(1);
    });
  });
});

/** @vitest-environment node */

import { AuthzCollectorService, AuthzService } from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { GrantsAuthzReadRepository } from "~/server/app-layer/authz/repositories/authz-read.grants.repository";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import {
  seedGrantBinding,
  seedRoleProjection,
} from "../../../../../prisma/seed-authz";

const namespace = generate("seedauth").toString();
const organizationId = `${namespace}-org`;
const userId = `${namespace}-user`;
const adoptedGrantId = `${namespace}-adopted`;
const roleId = `${namespace}-role`;
const restrictedGrantId = `${namespace}-restricted`;
const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
});

const restrictedRole = {
  id: roleId,
  organizationId,
  name: "Seed restricted role",
  description: "Seed test role",
  permissions: ["traces:view"],
  kind: "custom" as const,
};

describe("authz seed projections", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: organizationId, slug: organizationId },
    });
    await prisma.user.create({
      data: { id: userId, name: "Seed user", email: `${userId}@example.test` },
    });
    await prisma.organizationUser.create({
      data: { organizationId, userId, role: "MEMBER" },
    });
  });

  afterAll(async () => {
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.grant.deleteMany({ where: { organizationId } });
    await prisma.role.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("adopts compat rows, resolves restricted permissions, and preserves tombstones", async () => {
    await prisma.roleBinding.create({
      data: {
        id: adoptedGrantId,
        organizationId,
        userId,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });

    const adopted = {
      id: adoptedGrantId,
      organizationId,
      principal: { type: "user" as const, id: userId },
      role: TeamUserRole.MEMBER,
      scope: { type: "ORGANIZATION" as const, id: organizationId },
    };
    expect(await seedGrantBinding(prisma, adopted)).toBe(true);
    const adoptedGrant = await prisma.grant.findUnique({
      where: { id: adoptedGrantId },
    });
    expect(adoptedGrant?.organizationId).toBe(organizationId);
    expect(
      await prisma.roleBinding.count({ where: { id: adoptedGrantId } }),
    ).toBe(1);

    expect(await seedGrantBinding(prisma, adopted)).toBe(true);
    expect(await prisma.grant.count({ where: { id: adoptedGrantId } })).toBe(1);
    expect(
      await prisma.roleBinding.count({ where: { id: adoptedGrantId } }),
    ).toBe(1);

    await prisma.grant.update({
      where: { id: adoptedGrantId },
      data: { revokedAt: new Date() },
    });

    expect(await seedRoleProjection({ prisma, ...restrictedRole })).toBe(true);
    const restricted = {
      id: restrictedGrantId,
      organizationId,
      principal: { type: "user" as const, id: userId },
      role: TeamUserRole.CUSTOM,
      customRoleId: roleId,
      scope: { type: "ORGANIZATION" as const, id: organizationId },
    };
    expect(await seedGrantBinding(prisma, restricted)).toBe(true);

    const authz = new AuthzService(
      new AuthzCollectorService(new GrantsAuthzReadRepository(prisma)),
    );
    const scope = { type: "organization" as const, id: organizationId };
    expect(
      (
        await authz.check({
          principal: { type: "user", id: userId },
          permission: "traces:view",
          scope,
        })
      ).allowed,
    ).toBe(true);
    expect(
      (
        await authz.check({
          principal: { type: "user", id: userId },
          permission: "datasets:manage",
          scope,
        })
      ).allowed,
    ).toBe(false);

    await prisma.grant.update({
      where: { id: restrictedGrantId },
      data: { revokedAt: new Date() },
    });
    expect(await seedGrantBinding(prisma, restricted)).toBe(false);
    expect(
      (await prisma.grant.findUnique({ where: { id: restrictedGrantId } }))
        ?.revokedAt,
    ).not.toBeNull();
    expect(
      await prisma.roleBinding.count({ where: { id: restrictedGrantId } }),
    ).toBe(0);
    expect(
      (
        await authz.check({
          principal: { type: "user", id: userId },
          permission: "traces:view",
          scope,
        })
      ).allowed,
    ).toBe(false);

    await prisma.role.update({
      where: { id: roleId },
      data: { deletedAt: new Date() },
    });
    expect(await seedRoleProjection({ prisma, ...restrictedRole })).toBe(false);
    expect(
      (await prisma.role.findUnique({ where: { id: roleId } }))?.deletedAt,
    ).not.toBeNull();
  });
});

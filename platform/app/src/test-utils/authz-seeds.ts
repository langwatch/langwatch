import { roleKeyForTeamRole } from "@langwatch/authz";
import type { LedgerPrincipal } from "@langwatch/authz-server";
import { grantFactToRow, roleFactToRow } from "@langwatch/authz-server";
import { z } from "zod";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";

type RoleBindingSeed = Omit<
  Prisma.RoleBindingUncheckedCreateInput,
  "userId" | "groupId"
> &
  ({ userId: string; groupId?: never } | { groupId: string; userId?: never });

/** Seed current authorization facts and their compatibility rows together. */
export async function seedRoleBinding(
  prisma: PrismaClient,
  data: RoleBindingSeed,
) {
  return prisma.$transaction(async (tx) => {
    const binding = await tx.roleBinding.create({ data });
    let principal: LedgerPrincipal;
    if ("userId" in data && data.userId !== undefined) {
      principal = { type: "user", id: data.userId };
    } else if ("groupId" in data && data.groupId !== undefined) {
      principal = { type: "group", id: data.groupId };
    } else {
      throw new Error("A role binding seed needs a principal");
    }
    await tx.grant.create({
      data: grantFactToRow({
        organizationId: binding.organizationId,
        grant: {
          grantId: binding.id,
          principal,
          roleKey: binding.customRoleId
            ? `custom:${binding.customRoleId}`
            : roleKeyForTeamRole(binding.role),
          legacyRole: binding.role,
          scope: { type: binding.scopeType, id: binding.scopeId },
          source: "grants-service",
          occurredAtMs: binding.createdAt.getTime(),
        },
      }),
    });
    return binding;
  });
}

export async function seedCustomRole(
  prisma: PrismaClient,
  data: Prisma.CustomRoleUncheckedCreateInput,
) {
  return prisma.$transaction(async (tx) => {
    const role = await tx.customRole.create({ data });
    await tx.role.create({
      data: roleFactToRow({
        organizationId: role.organizationId,
        role: {
          roleId: role.id,
          name: role.name,
          ...(role.description === null
            ? {}
            : { description: role.description }),
          permissions: z.array(z.string()).parse(role.permissions),
          kind: z.enum(["custom", "system_api_key"]).parse(role.kind),
          occurredAtMs: role.createdAt.getTime(),
        },
      }),
    });
    return role;
  });
}

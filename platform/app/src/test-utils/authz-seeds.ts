import { roleKeyForTeamRole } from "@langwatch/authz";
import { grantFactToRow } from "@langwatch/authz-server";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";

/** Seed current authorization facts and their compatibility rows together. */
export async function seedRoleBinding(
  prisma: PrismaClient,
  data: Prisma.RoleBindingUncheckedCreateInput & { userId: string },
) {
  return prisma.$transaction(async (tx) => {
    const binding = await tx.roleBinding.create({ data });
    await tx.grant.create({
      data: grantFactToRow({
        organizationId: binding.organizationId,
        grant: {
          grantId: binding.id,
          principal: { type: "user", id: data.userId },
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

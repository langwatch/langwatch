import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

export async function assertUsersInOrganization(
  prisma: PrismaClient,
  organizationId: string,
  userIds: string[],
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) return;

  const count = await prisma.organizationUser.count({
    where: { organizationId, userId: { in: uniqueUserIds } },
  });
  if (count !== uniqueUserIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "One or more users are not in this organization",
    });
  }
}

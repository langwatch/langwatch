import { createApiFixture } from "@langwatch/api-fixture";
import {
  GroupNotFoundError,
  MemberNotFoundError,
  type OrganizationApi,
} from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";

const GROUP_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  externalId: true,
  scimSource: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The organization reads the gateway makes (a member, a group, a person's groups),
 * answered from seeded rows: the gateway depends on the contract only.
 */
export function organizationApiOver(
  prisma: Pick<PrismaClient, "organizationUser" | "group">,
): Pick<OrganizationApi, "getMember" | "getGroup" | "listGroupsForMember"> {
  return createApiFixture<OrganizationApi>({
    getMember: async ({ organizationId, userId }) => {
      const row = await prisma.organizationUser.findFirst({
        where: { organizationId, userId },
        select: { role: true, disabledAt: true, createdAt: true, updatedAt: true },
      });
      if (!row) throw new MemberNotFoundError(userId);

      return {
        userId,
        organizationId,
        role: row.role,
        disabledAt: row.disabledAt ? fromDate(row.disabledAt) : null,
        createdAt: fromDate(row.createdAt),
        updatedAt: fromDate(row.updatedAt),
        user: { id: userId, name: null, email: null },
        teams: [],
      };
    },
    getGroup: async ({ organizationId, groupId }) => {
      const group = await prisma.group.findFirst({
        where: { id: groupId, organizationId },
        select: GROUP_SELECT,
      });
      if (!group) throw new GroupNotFoundError(groupId);

      return { ...group, members: [], grants: [] };
    },
    listGroupsForMember: async ({ organizationId, userId }) => {
      const groups = await prisma.group.findMany({
        where: { organizationId, members: { some: { userId } } },
        select: GROUP_SELECT,
        orderBy: { name: "asc" },
      });

      return groups.map((group) => ({ ...group, memberCount: 0, grants: [] }));
    },
  });
}

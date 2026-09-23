// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { ProcessMembers } from "@langwatch/process-stores/members";

import type {
  GovernanceActorDirectory,
  GovernancePersonalVirtualKeyMembers,
} from "./governance.app.ts";

export type GovernanceMemberDatabase = Pick<
  ProcessMembers["prisma"],
  "organizationUser" | "user" | "virtualKey"
>;

export function createGovernanceMemberInfrastructure(
  database: GovernanceMemberDatabase,
): Pick<
  { actors: GovernanceActorDirectory; personalVirtualKeys: GovernancePersonalVirtualKeyMembers },
  "actors" | "personalVirtualKeys"
> {
  return {
    actors: {
      findUser: ({ token }) =>
        database.user.findFirst({
          where: { OR: [{ id: token }, { email: token }] },
          select: { id: true, name: true, email: true },
        }),
    },
    personalVirtualKeys: {
      async isOrganizationMember({ organizationId, userId }) {
        const membership = await database.organizationUser.findFirst({
          where: { organizationId, userId, disabledAt: null },
          select: { userId: true },
        });
        return membership !== null;
      },
      async hasActivePersonalKeyLabelled({ organizationId, userId, label }) {
        const key = await database.virtualKey.findFirst({
          where: {
            organizationId,
            principalUserId: userId,
            name: label,
            revokedAt: null,
          },
          select: { id: true },
        });
        return key !== null;
      },
    },
  };
}

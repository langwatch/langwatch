// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  NurturingMemberSourceRepository,
  NurturingSourceMember,
} from "../nurturing-member-source.repository.ts";

/** Only the shared delegates this reader touches; it claims no table (R40). */
type PrismaNurturingMemberSourceDatabase = Pick<PrismaClient, "organization" | "organizationUser">;

/** Organization's `Organization` and `OrganizationUser` rows, through shares (R40). */
export class PrismaNurturingMemberSourceRepository implements NurturingMemberSourceRepository {
  private constructor(private readonly prisma: PrismaNurturingMemberSourceDatabase) {}

  static create({
    prisma,
  }: Readonly<{
    prisma: PrismaNurturingMemberSourceDatabase;
  }>): PrismaNurturingMemberSourceRepository {
    return new PrismaNurturingMemberSourceRepository(prisma);
  }

  async listOrganizationIds({
    after,
    limit,
  }: Readonly<{ after?: string; limit: number }>): Promise<string[]> {
    const rows = await this.prisma.organization.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: limit,
      ...(after === undefined ? {} : { where: { id: { gt: after } } }),
    });
    return rows.map(({ id }) => id);
  }

  async findActiveMembers({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingSourceMember[]> {
    const rows = await this.prisma.organizationUser.findMany({
      where: { organizationId, disabledAt: null, user: { deactivatedAt: null } },
      select: { userId: true, createdAt: true },
    });
    return rows.map(({ userId, createdAt }) => ({ userId, joinedAt: createdAt.getTime() }));
  }
}

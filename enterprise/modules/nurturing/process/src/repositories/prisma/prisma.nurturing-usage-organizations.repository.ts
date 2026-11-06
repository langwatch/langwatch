// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  OperatorRead,
  type PrismaModelClient,
  type ScopedOperatorReads,
} from "@langwatch/prisma-client";

import type {
  NurturingUsageOrganization,
  NurturingUsageOrganizationsRepository,
} from "../nurturing-usage-organizations.repository.ts";

/** Nurturing's declared read across organizations, named on `NurturingModule` (ARCHITECTURE §7). */
export const nurturingOperatorReads = {
  usageOrganizations: OperatorRead.of("NurturingOrganization", { actions: ["findMany"] }),
};

/** The member the root hands nurturing's live registry, scoped to the handle above. */
export type NurturingOperatorReadsMember = Readonly<{ operatorReads: ScopedOperatorReads }>;

export class PrismaNurturingUsageOrganizationsRepository implements NurturingUsageOrganizationsRepository {
  private constructor(private readonly prisma: PrismaModelClient<"NurturingOrganization">) {}

  static create({
    operatorReads,
  }: NurturingOperatorReadsMember): PrismaNurturingUsageOrganizationsRepository {
    return operatorReads.into(
      nurturingOperatorReads.usageOrganizations,
      (prisma) => new PrismaNurturingUsageOrganizationsRepository(prisma),
    );
  }

  async findRecentlyActive({
    since,
    afterId,
    limit,
  }: Parameters<NurturingUsageOrganizationsRepository["findRecentlyActive"]>[0]): Promise<
    NurturingUsageOrganization[]
  > {
    const at = new Date(since);
    const rows = await this.prisma.nurturingOrganization.findMany({
      where: {
        adminUserId: { not: null },
        // A trace moves lastTraceAt forward. With none yet, updatedAt is at least the row's
        // creation (Prisma sets it on create), so a new organization is synced with zeros.
        OR: [{ lastTraceAt: { gte: at } }, { lastTraceAt: null, updatedAt: { gte: at } }],
        ...(afterId ? { organizationId: { gt: afterId } } : {}),
      },
      orderBy: { organizationId: "asc" },
      take: limit,
      select: { organizationId: true, adminUserId: true },
    });
    return rows.flatMap(({ organizationId, adminUserId }) =>
      adminUserId ? [{ organizationId, adminUserId }] : [],
    );
  }
}

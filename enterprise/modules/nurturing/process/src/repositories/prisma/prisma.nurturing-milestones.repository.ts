// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";
import { Prisma } from "@langwatch/prisma-client/generated";

import type {
  NurturingMilestonesRepository,
  NurturingOrganizationCounts,
} from "../nurturing-milestones.repository.ts";

const ORGANIZATION_STATE = {
  organizationId: true,
  adminUserId: true,
  seeded: true,
  evaluationCount: true,
  simulationRunCount: true,
} as const;

/** Nurturing's organizations, the one table it claims; the owners' rows are read elsewhere (R40). */
export class PrismaNurturingMilestonesRepository
  extends PrismaRepository.for("NurturingOrganization")
  implements NurturingMilestonesRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaNurturingMilestonesRepository(prisma),
  );

  async recordOrganization({
    organizationId,
    adminUserId,
    seeded,
  }: Parameters<NurturingMilestonesRepository["recordOrganization"]>[0]): Promise<void> {
    const update = adminUserId ? { adminUserId } : {};
    const upsert = () =>
      this.prisma.nurturingOrganization.upsert({
        where: { organizationId },
        create: { organizationId, adminUserId, seeded },
        update,
      });
    try {
      await upsert();
    } catch (error) {
      // Concurrent events for one organization race the create; the loser now updates the row.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
        throw error;
      await upsert();
    }
  }

  countEvaluation({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingOrganizationCounts[]> {
    return this.count({ organizationId, data: { evaluationCount: { increment: 1 } } });
  }

  countSimulationRun({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingOrganizationCounts[]> {
    return this.count({ organizationId, data: { simulationRunCount: { increment: 1 } } });
  }

  /** Empty when nurturing never learned the organization. */
  private async count({
    organizationId,
    data,
  }: {
    organizationId: string;
    data: { evaluationCount: { increment: 1 } } | { simulationRunCount: { increment: 1 } };
  }): Promise<NurturingOrganizationCounts[]> {
    const { count } = await this.prisma.nurturingOrganization.updateMany({
      where: { organizationId },
      data,
    });
    if (count === 0) return [];
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: ORGANIZATION_STATE,
    });
    return organization ? [organization] : [];
  }
}

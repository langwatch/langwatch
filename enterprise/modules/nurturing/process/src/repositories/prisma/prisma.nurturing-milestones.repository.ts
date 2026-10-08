// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  NurturingMilestonesRepository,
  NurturingOrganizationState,
} from "../nurturing-milestones.repository.ts";

const ORGANIZATION_STATE = {
  organizationId: true,
  adminUserId: true,
  seeded: true,
  evaluationCount: true,
  simulationRunCount: true,
} as const;

/** Only the shared delegates the placement read touches; it claims no table (R40). */
type NurturingProjectShare = Pick<PrismaClient, "project" | "team">;

/** Nurturing's organizations; a project's organization is read through its owners' shares (R40). */
export class PrismaNurturingMilestonesRepository
  extends PrismaRepository.for("NurturingOrganization")
  implements NurturingMilestonesRepository
{
  static create({ prisma }: { prisma: PrismaClient }): PrismaNurturingMilestonesRepository {
    return new PrismaNurturingMilestonesRepository(prisma, prisma);
  }

  private constructor(
    prisma: PrismaClient,
    private readonly projects: NurturingProjectShare,
  ) {
    super(prisma);
  }

  async recordOrganization({
    organizationId,
    adminUserId,
    seeded,
  }: Parameters<NurturingMilestonesRepository["recordOrganization"]>[0]): Promise<void> {
    await this.prisma.nurturingOrganization.upsert({
      where: { organizationId },
      create: { organizationId, adminUserId, seeded },
      update: adminUserId ? { adminUserId } : {},
    });
  }

  countEvaluation({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingOrganizationState[]> {
    return this.count({ projectId, data: { evaluationCount: { increment: 1 } } });
  }

  countSimulationRun({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingOrganizationState[]> {
    return this.count({ projectId, data: { simulationRunCount: { increment: 1 } } });
  }

  /** Empty when the owners hold no such project or nurturing never learned its organization. */
  private async count({
    projectId,
    data,
  }: {
    projectId: string;
    data: { evaluationCount: { increment: 1 } } | { simulationRunCount: { increment: 1 } };
  }): Promise<NurturingOrganizationState[]> {
    const organizationId = await this.organizationOf({ projectId });
    if (!organizationId) return [];
    const { count } = await this.prisma.nurturingOrganization.updateMany({
      where: { organizationId },
      data,
    });
    if (count === 0) return [];
    const organization = await this.prisma.nurturingOrganization.findUnique({
      where: { organizationId },
      select: ORGANIZATION_STATE,
    });
    if (!organization) return [];
    const firstProjectCreatedAt = await this.firstProjectCreatedAt({ organizationId });
    return [{ ...organization, firstProjectCreatedAt }];
  }

  /** The organization's earliest project, archived ones included, through its teams. */
  private async firstProjectCreatedAt({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number | null> {
    const teams = await this.projects.team.findMany({
      where: { organizationId },
      select: { id: true },
    });
    if (teams.length === 0) return null;
    const { _min } = await this.projects.project.aggregate({
      where: { teamId: { in: teams.map(({ id }) => id) } },
      _min: { createdAt: true },
    });
    return _min.createdAt ? _min.createdAt.getTime() : null;
  }

  private async organizationOf({ projectId }: { projectId: string }): Promise<string | undefined> {
    const project = await this.projects.project.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
    if (!project) return void 0;
    const team = await this.projects.team.findUnique({
      where: { id: project.teamId },
      select: { organizationId: true },
    });
    return team?.organizationId;
  }
}

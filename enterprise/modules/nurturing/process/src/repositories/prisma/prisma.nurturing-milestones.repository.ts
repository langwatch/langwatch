// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";

import type {
  NurturingMilestonesRepository,
  NurturingOrganizationState,
} from "../nurturing-milestones.repository.ts";

export class PrismaNurturingMilestonesRepository
  extends PrismaRepository.for("NurturingProject", "NurturingOrganization")
  implements NurturingMilestonesRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaNurturingMilestonesRepository(prisma),
  );

  async recordProject({
    projectId,
    organizationId,
    adminUserId,
    seeded,
  }: Parameters<NurturingMilestonesRepository["recordProject"]>[0]): Promise<void> {
    await this.prisma.nurturingOrganization.upsert({
      where: { organizationId },
      create: { organizationId, adminUserId, seeded },
      update: adminUserId ? { adminUserId } : {},
    });
    await this.prisma.nurturingProject.upsert({
      where: { projectId },
      create: { projectId, organizationId },
      update: { organizationId },
    });
  }

  async countEvaluation({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingOrganizationState[]> {
    const project = await this.prisma.nurturingProject.findUnique({ where: { projectId } });
    if (!project) return [];
    const organization = await this.prisma.nurturingOrganization.update({
      where: { organizationId: project.organizationId },
      data: { evaluationCount: { increment: 1 } },
      select: { organizationId: true, adminUserId: true, seeded: true, evaluationCount: true },
    });
    return [organization];
  }
}

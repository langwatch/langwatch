// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  NurturingProjectDirectoryRepository,
  NurturingProjectPlacement,
} from "../nurturing-project-directory.repository.ts";

/** Only the shared delegates this reader touches; it claims no table (R40). */
type PrismaNurturingProjectDirectoryDatabase = Pick<
  PrismaClient,
  "project" | "team" | "organization"
>;

/** Project's `Project` and organization's `Team` and `Organization` rows, through shares (R40). */
export class PrismaNurturingProjectDirectoryRepository implements NurturingProjectDirectoryRepository {
  private constructor(private readonly prisma: PrismaNurturingProjectDirectoryDatabase) {}

  static create({
    prisma,
  }: Readonly<{
    prisma: PrismaNurturingProjectDirectoryDatabase;
  }>): PrismaNurturingProjectDirectoryRepository {
    return new PrismaNurturingProjectDirectoryRepository(prisma);
  }

  async getPlacement({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingProjectPlacement> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { teamId: true },
    });
    if (!project) return { outcome: "unknown" };
    const team = await this.prisma.team.findUnique({
      where: { id: project.teamId },
      select: { organizationId: true },
    });
    return team
      ? { outcome: "known", organizationId: team.organizationId }
      : { outcome: "unknown" };
  }

  async findPersonalOwnerUserIds({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<string[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { isPersonal: true, ownerUserId: true },
    });
    return project?.isPersonal && project.ownerUserId ? [project.ownerUserId] : [];
  }

  async getFirstProjectCreatedAt({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<{ firstProjectCreatedAt: number | null }> {
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true },
    });
    if (teams.length === 0) return { firstProjectCreatedAt: null };
    const { _min } = await this.prisma.project.aggregate({
      where: { teamId: { in: teams.map(({ id }) => id) } },
      _min: { createdAt: true },
    });
    return { firstProjectCreatedAt: _min.createdAt ? _min.createdAt.getTime() : null };
  }

  async getOrganizationCreatedAt({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<{ organizationCreatedAt: number | null }> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { createdAt: true },
    });
    return { organizationCreatedAt: organization?.createdAt.getTime() ?? null };
  }

  async hasTracedProject({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<boolean> {
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true },
    });
    if (teams.length === 0) return false;
    const traced = await this.prisma.project.findFirst({
      where: { teamId: { in: teams.map(({ id }) => id) }, firstMessage: true },
      select: { id: true },
    });
    return traced !== null;
  }
}

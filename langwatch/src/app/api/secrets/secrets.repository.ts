import type { PrismaClient } from "@prisma/client";
import { RoleBindingScopeType } from "@prisma/client";

export class SecretsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAllByProject({ projectId }: { projectId: string }) {
    return this.prisma.projectSecret.findMany({
      where: { projectId },
      select: {
        id: true,
        projectId: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: "asc" },
    });
  }

  async findByIdInProject({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }) {
    return this.prisma.projectSecret.findFirst({
      where: { id, projectId },
      select: {
        id: true,
        projectId: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findByNameInProject({
    name,
    projectId,
  }: {
    name: string;
    projectId: string;
  }) {
    return this.prisma.projectSecret.findFirst({
      where: { projectId, name },
      select: { id: true },
    });
  }

  async countByProject({ projectId }: { projectId: string }) {
    return this.prisma.projectSecret.count({
      where: { projectId },
    });
  }

  async create({
    projectId,
    name,
    encryptedValue,
    userId,
  }: {
    projectId: string;
    name: string;
    encryptedValue: string;
    userId: string;
  }) {
    return this.prisma.projectSecret.create({
      data: {
        projectId,
        name,
        encryptedValue,
        createdById: userId,
        updatedById: userId,
      },
      select: {
        id: true,
        projectId: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async update({
    id,
    projectId,
    encryptedValue,
  }: {
    id: string;
    projectId: string;
    encryptedValue: string;
  }) {
    return this.prisma.projectSecret.update({
      where: { id, projectId },
      data: { encryptedValue },
      select: {
        id: true,
        projectId: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async delete({ id, projectId }: { id: string; projectId: string }) {
    await this.prisma.projectSecret.delete({
      where: { id, projectId },
    });
  }

  async findFallbackOwner({ teamId }: { teamId: string }) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });

    if (!team) return null;

    const binding = await this.prisma.roleBinding.findFirst({
      where: {
        organizationId: team.organizationId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
        userId: { not: null },
      },
      select: { userId: true },
    });

    return binding?.userId ?? null;
  }
}

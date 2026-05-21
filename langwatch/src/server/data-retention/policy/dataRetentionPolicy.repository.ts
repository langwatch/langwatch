import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { RetentionPolicy } from "../retentionPolicy.schema";

export interface ProjectPolicyResult {
  projectPolicy: RetentionPolicy | null;
  orgPolicy: RetentionPolicy | null;
}

export class DataRetentionPolicyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findProjectPolicy({
    projectId,
  }: {
    projectId: string;
  }): Promise<ProjectPolicyResult> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      select: {
        retentionPolicy: true,
        team: {
          select: {
            organization: {
              select: { defaultRetentionPolicy: true },
            },
          },
        },
      },
    });

    return {
      projectPolicy: (project?.retentionPolicy as RetentionPolicy | null) ?? null,
      orgPolicy: (project?.team?.organization?.defaultRetentionPolicy as RetentionPolicy | null) ?? null,
    };
  }

  async updateProjectPolicy({
    projectId,
    retentionPolicy,
  }: {
    projectId: string;
    retentionPolicy: RetentionPolicy | null;
  }): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        retentionPolicy: retentionPolicy ?? Prisma.JsonNull,
      },
    });
  }

  async updateOrgPolicy({
    organizationId,
    defaultRetentionPolicy,
  }: {
    organizationId: string;
    defaultRetentionPolicy: RetentionPolicy | null;
  }): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        defaultRetentionPolicy: defaultRetentionPolicy ?? Prisma.JsonNull,
      },
    });
  }
}

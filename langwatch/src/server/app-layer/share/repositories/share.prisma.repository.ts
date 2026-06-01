import type { PrismaClient, PublicShare } from "@prisma/client";
import type {
  ShareRepository,
  ShareResourceType,
  ShareWithProject,
} from "./share.repository";

export class PrismaShareRepository implements ShareRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ShareWithProject | null> {
    return this.prisma.publicShare.findFirst({
      where: { id },
      include: { project: { select: { traceSharingEnabled: true } } },
    });
  }

  async findByResource({
    projectId,
    resourceType,
    resourceId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<PublicShare | null> {
    return this.prisma.publicShare.findFirst({
      where: { projectId, resourceType, resourceId },
    });
  }

  async findByResourceType({
    resourceType,
    resourceId,
  }: {
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<PublicShare | null> {
    return this.prisma.publicShare.findFirst({
      where: { resourceType, resourceId },
    });
  }

  async create({
    projectId,
    resourceType,
    resourceId,
    userId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
    userId?: string | null;
  }): Promise<PublicShare> {
    return this.prisma.publicShare.create({
      data: {
        projectId,
        resourceType,
        resourceId,
        userId: userId ?? null,
      },
    });
  }

  async deleteByResource({
    projectId,
    resourceType,
    resourceId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<void> {
    await this.prisma.publicShare.deleteMany({
      where: { projectId, resourceType, resourceId },
    });
  }

  async findAllTraceShareResourceIds(projectId: string): Promise<string[]> {
    const rows = await this.prisma.publicShare.findMany({
      where: { projectId, resourceType: "TRACE" },
      select: { resourceId: true },
    });
    return rows.map((r) => r.resourceId);
  }

  async deleteAllTraceShares(projectId: string): Promise<void> {
    await this.prisma.publicShare.deleteMany({
      where: { projectId, resourceType: "TRACE" },
    });
  }
}

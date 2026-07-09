import type { PrismaClient, ShareLink } from "@prisma/client";
import type {
  CreateShareLinkParams,
  ShareRepository,
  ShareResourceType,
  ShareWithProject,
} from "./share.repository";

const projectInclude = {
  project: {
    select: {
      traceSharingEnabled: true,
      team: { select: { organizationId: true } },
    },
  },
} as const;

export class PrismaShareRepository implements ShareRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByToken(token: string): Promise<ShareWithProject | null> {
    return this.prisma.shareLink.findUnique({
      where: { token },
      include: projectInclude,
    });
  }

  async findById(id: string): Promise<ShareWithProject | null> {
    return this.prisma.shareLink.findUnique({
      where: { id },
      include: projectInclude,
    });
  }

  async listByResource({
    projectId,
    resourceType,
    resourceId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<ShareLink[]> {
    return this.prisma.shareLink.findMany({
      where: { projectId, resourceType, resourceId },
      orderBy: { createdAt: "desc" },
    });
  }

  async hasActiveShareForResource({
    projectId,
    resourceType,
    resourceId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<boolean> {
    const count = await this.prisma.shareLink.count({
      where: {
        projectId,
        resourceType,
        resourceId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return count > 0;
  }

  async create({
    token,
    projectId,
    resourceType,
    resourceId,
    threadId,
    visibility,
    expiresAt,
    maxViews,
    userId,
  }: CreateShareLinkParams): Promise<ShareLink> {
    return this.prisma.shareLink.create({
      data: {
        token,
        projectId,
        resourceType,
        resourceId,
        threadId: threadId ?? null,
        visibility: visibility ?? "PUBLIC",
        expiresAt: expiresAt ?? null,
        maxViews: maxViews ?? null,
        userId: userId ?? null,
      },
    });
  }

  async incrementViewCount({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<void> {
    // updateMany (not update) so the where clause can carry projectId — the
    // multitenancy guard rejects writes scoped only by primary key.
    await this.prisma.shareLink.updateMany({
      where: { id, projectId },
      data: { viewCount: { increment: 1 } },
    });
  }

  async deleteById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<void> {
    await this.prisma.shareLink.deleteMany({ where: { id, projectId } });
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
    await this.prisma.shareLink.deleteMany({
      where: { projectId, resourceType, resourceId },
    });
  }

  async findAllTraceShareResourceIds(projectId: string): Promise<string[]> {
    const rows = await this.prisma.shareLink.findMany({
      where: { projectId, resourceType: "TRACE" },
      select: { resourceId: true },
      distinct: ["resourceId"],
    });
    return rows.map((r) => r.resourceId);
  }

  async deleteAllTraceShares(projectId: string): Promise<void> {
    await this.prisma.shareLink.deleteMany({
      where: { projectId, resourceType: "TRACE" },
    });
  }
}

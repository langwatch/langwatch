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
    maxViews,
  }: {
    id: string;
    projectId: string;
    maxViews: number | null;
  }): Promise<boolean> {
    // Atomic conditional update: only increment if the link exists and either
    // maxViews is null (unlimited) or viewCount < maxViews. This prevents race
    // conditions where concurrent resolves could all pass the view-exhausted check
    // and each consume a view beyond the cap.
    const result = await this.prisma.shareLink.updateMany({
      where: {
        id,
        projectId,
        // If maxViews is null, no limit — always allow
        // If maxViews is set, only allow if viewCount < maxViews
        ...(maxViews !== null
          ? { viewCount: { lt: maxViews } }
          : {}),
      },
      data: { viewCount: { increment: 1 } },
    });
    // count of updated rows: 1 means we consumed a view, 0 means exhausted or deleted
    return result.count > 0;
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

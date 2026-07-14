import type { Prisma, PrismaClient, ShareLink } from "@prisma/client";
import type {
  CreateShareLinkParams,
  ShareRepository,
  ShareResourceType,
  ShareWithProject,
} from "./share.repository";

const projectInclude = {
  project: {
    select: {
      id: true,
      name: true,
      slug: true,
      language: true,
      framework: true,
      traceSharingEnabled: true,
      team: { select: { organizationId: true } },
    },
  },
} as const;

export class PrismaShareRepository implements ShareRepository {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {}

  withTransaction(
    transaction: Prisma.TransactionClient,
  ): PrismaShareRepository {
    return new PrismaShareRepository(transaction);
  }

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
    // Atomic conditional update: only increment if the link still exists, has
    // not expired, and either maxViews is null (unlimited) or viewCount is below
    // the cap. Grant signing happens before this write, so an expiry race can
    // neither spend a view nor leave the caller without a mintable grant.
    const result = await this.prisma.shareLink.updateMany({
      where: {
        id,
        projectId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        ...(maxViews !== null ? { viewCount: { lt: maxViews } } : {}),
      },
      data: { viewCount: { increment: 1 } },
    });
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

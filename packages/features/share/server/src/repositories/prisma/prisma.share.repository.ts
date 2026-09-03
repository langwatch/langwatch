import { shareLinkSchema, shareWithProjectSchema, type ShareLink } from "@langwatch/share-contract";
import type { ShareDatabase } from "../../ports/share-database.port";
import {
  ShareRepository,
  type CreateShareLinkParams,
  type ShareResourceType,
  type ShareWithProject,
} from "../share.repository";

const projectInclude = {
  project: {
    select: {
      traceSharingEnabled: true,
      team: {
        select: {
          organizationId: true,
          organization: { select: { traceSharingEnabled: true } },
        },
      },
    },
  },
};

function resourceIdFromRow(row: unknown): string {
  if (
    typeof row !== "object" ||
    row === null ||
    !("resourceId" in row) ||
    typeof row.resourceId !== "string"
  ) {
    throw new Error("Share resource id query returned an invalid row");
  }

  return row.resourceId;
}

export class PrismaShareRepository extends ShareRepository {
  static create(options: { database: ShareDatabase }): PrismaShareRepository {
    return new PrismaShareRepository(options.database);
  }

  private constructor(private readonly prisma: ShareDatabase) {
    super();
  }

  async tryFindByToken(token: string): Promise<ShareWithProject | null> {
    const row = await this.prisma.shareLink.findUnique({
      where: { token },
      include: projectInclude,
    });

    return row ? shareWithProjectSchema.parse(row) : null;
  }

  async tryFindById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<ShareWithProject | null> {
    // findFirst (not findUnique): the where carries projectId so the lookup is
    // tenant-scoped in the query itself, not just checked after the fetch.
    const row = await this.prisma.shareLink.findFirst({
      where: { id, projectId },
      include: projectInclude,
    });

    return row ? shareWithProjectSchema.parse(row) : null;
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
    const rows = await this.prisma.shareLink.findMany({
      where: { projectId, resourceType, resourceId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((row) => shareLinkSchema.parse(row));
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
    visibility,
    expiresAt,
    maxViews,
    userId,
  }: CreateShareLinkParams): Promise<ShareLink> {
    const row = await this.prisma.shareLink.create({
      data: {
        token,
        projectId,
        resourceType,
        resourceId,
        visibility: visibility ?? "PUBLIC",
        expiresAt: expiresAt ?? null,
        maxViews: maxViews ?? null,
        userId: userId ?? null,
      },
    });

    return shareLinkSchema.parse(row);
  }

  async consumeView({
    id,
    projectId,
    maxViews,
  }: {
    id: string;
    projectId: string;
    maxViews: number | null;
  }): Promise<boolean> {
    // `update` with the cap in its (filtered-unique) where, NOT `updateMany`:
    // Prisma 7's compiler splits a conditional `updateMany` into a SELECT of
    // matching ids and an UPDATE keyed on those ids alone — the cap condition
    // does not ride the UPDATE, so concurrent opens of a capped link all
    // increment past it (read-then-write, not compare-and-swap). `update`
    // keeps its full filter on the UPDATE statement, where Postgres
    // re-evaluates it after the lock wait: the loser matches zero rows and
    // surfaces as P2025 instead of over-consuming. The projectId predicate is
    // the tenancy fence, same as every other query here.
    try {
      await this.prisma.shareLink.update({
        where: {
          id,
          projectId,
          ...(maxViews != null ? { viewCount: { lt: maxViews } } : {}),
        },
        data: { viewCount: { increment: 1 } },
      });

      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2025"
      ) {
        return false;
      }

      throw error;
    }
  }

  async deleteById({ id, projectId }: { id: string; projectId: string }): Promise<void> {
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

    return rows.map(resourceIdFromRow);
  }

  async deleteAllTraceShares(projectId: string): Promise<void> {
    await this.prisma.shareLink.deleteMany({
      where: { projectId, resourceType: "TRACE" },
    });
  }
}

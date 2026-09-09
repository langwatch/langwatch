import { PrismaRepository } from "@langwatch/prisma-client";
import { shareLinkSchema, shareWithProjectSchema, type ShareLink } from "@langwatch/share-contract";
import type { ShareResourceType } from "@langwatch/share-contract";
import { toDate } from "@langwatch/time";
import type {
  ConsumeShareViewParams,
  CreateShareLinkParams,
  ShareLinkScope,
  ShareRepository,
  ShareResourceScope,
} from "../share.repository.ts";
import type { ShareWithProject } from "@langwatch/share-contract";

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
} as const;

const idSelect = { id: true } as const;
const resourceIdSelect = { resourceId: true } as const;

/** Prisma's record-not-found failure, read off the code so it survives a client boundary. */
function isRecordNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

export class PrismaShareRepository
  extends PrismaRepository.for("ShareLink")
  implements ShareRepository
{
  static readonly create = this.factory((prisma) => new PrismaShareRepository(prisma));

  async findByToken(token: string): Promise<ShareWithProject | null> {
    const row = await this.prisma.shareLink.findUnique({
      where: { token },
      include: projectInclude,
    });

    return row ? shareWithProjectSchema.parse(row) : null;
  }

  async findById({ id, projectId }: ShareLinkScope): Promise<ShareWithProject | null> {
    // findFirst (not findUnique): the where carries projectId so the lookup is
    // tenant-scoped in the query itself, not just checked after the fetch.
    const row = await this.prisma.shareLink.findFirst({
      where: { id, projectId },
      include: projectInclude,
    });

    return row ? shareWithProjectSchema.parse(row) : null;
  }

  async existsById({ id, projectId }: ShareLinkScope): Promise<boolean> {
    const row = await this.prisma.shareLink.findFirst({
      where: { id, projectId },
      select: idSelect,
    });

    return row !== null;
  }

  async findAllByResource({
    projectId,
    resourceType,
    resourceId,
  }: ShareResourceScope): Promise<ShareLink[]> {
    const rows = await this.prisma.shareLink.findMany({
      where: { projectId, resourceType, resourceId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((row) => shareLinkSchema.parse(row));
  }

  async countActiveForResource({
    projectId,
    resourceType,
    resourceId,
  }: ShareResourceScope): Promise<number> {
    return this.prisma.shareLink.count({
      where: {
        projectId,
        resourceType,
        resourceId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
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
        expiresAt: expiresAt ? toDate(expiresAt) : null,
        maxViews: maxViews ?? null,
        userId: userId ?? null,
      },
    });

    return shareLinkSchema.parse(row);
  }

  async consumeView({ id, projectId, maxViews }: ConsumeShareViewParams): Promise<boolean> {
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
      if (isRecordNotFound(error)) {
        return false;
      }

      throw error;
    }
  }

  async findAllIdsByResource({
    projectId,
    resourceType,
    resourceId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId?: string;
  }): Promise<string[]> {
    const rows = await this.prisma.shareLink.findMany({
      where: {
        projectId,
        resourceType,
        ...(resourceId !== void 0 ? { resourceId } : {}),
      },
      select: idSelect,
    });

    return rows.map((row) => row.id);
  }

  async deleteById({ id, projectId }: ShareLinkScope): Promise<void> {
    await this.prisma.shareLink.deleteMany({ where: { id, projectId } });
  }

  async deleteByResource({
    projectId,
    resourceType,
    resourceId,
  }: ShareResourceScope): Promise<void> {
    await this.prisma.shareLink.deleteMany({
      where: { projectId, resourceType, resourceId },
    });
  }

  async findAllTraceShareResourceIds(projectId: string): Promise<string[]> {
    const rows = await this.prisma.shareLink.findMany({
      where: { projectId, resourceType: "TRACE" },
      select: resourceIdSelect,
      distinct: ["resourceId"],
    });

    return rows.map((row) => row.resourceId);
  }

  async deleteAllTraceShares(projectId: string): Promise<void> {
    await this.prisma.shareLink.deleteMany({
      where: { projectId, resourceType: "TRACE" },
    });
  }
}

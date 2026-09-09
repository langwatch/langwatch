/**
 * The grants-ledger head of a share link. GrantUsage owns a cut-over link's
 * view count; the ShareLink count is its rollback-safe mirror (ADR-092,
 * decision 22).
 */
import { PrismaRepository } from "@langwatch/prisma-client";
import { nowInstant, toDate } from "@langwatch/time";
import type {
  ConsumeShareUsageParams,
  ShareGrantRepository,
  ShareGrantScope,
} from "../share-grant.repository.ts";

const idSelect = { id: true } as const;
const organizationSelect = { team: { select: { organizationId: true } } } as const;

/** Prisma's unique-constraint failure, read off the code so it survives a client boundary. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/** Prisma's record-not-found failure (P2025) — what a conditioned `update`
 *  raises when its filter matches no row, read off the code for the same
 *  reason as above. */
function isRecordNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

type UsageTransaction = Readonly<{
  grantUsage: {
    update(args: object): Promise<unknown>;
    create(args: object): Promise<unknown>;
  };
  shareLink: { update(args: object): Promise<unknown> };
}>;

/** The cap, as a where fragment, so both writes are fenced by the same terms. */
function capped(maxViews: number | null): object {
  return maxViews != null ? { viewCount: { lt: maxViews } } : {};
}

/**
 * `update`, unlike Prisma 7 `updateMany`, keeps the cap on the SQL UPDATE, so
 * the loser of a race matches no row and raises P2025 instead of over-consuming.
 */
async function incrementUsage(
  db: UsageTransaction,
  params: ConsumeShareUsageParams,
): Promise<boolean> {
  try {
    await db.grantUsage.update({
      where: {
        grantId: params.grantId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        ...capped(params.maxViews),
      },
      data: { viewCount: { increment: 1 }, lastViewedAt: toDate(nowInstant()) },
    });
    return true;
  } catch (error) {
    if (isRecordNotFound(error)) return false;
    throw error;
  }
}

/** Mirror in the same transaction; the projection never writes viewCount. */
async function mirrorUsage(db: UsageTransaction, params: ConsumeShareUsageParams): Promise<void> {
  try {
    await db.shareLink.update({
      where: { id: params.grantId, projectId: params.projectId, ...capped(params.maxViews) },
      data: { viewCount: { increment: 1 } },
    });
  } catch (error) {
    // A missing or exhausted mirror is not a failed authoritative consume.
    if (!isRecordNotFound(error)) throw error;
  }
}

export class PrismaShareGrantRepository
  extends PrismaRepository.transactionalFor("ShareLink", "Project", "Grant", "GrantUsage")
  implements ShareGrantRepository
{
  static readonly create = this.factory((prisma) => new PrismaShareGrantRepository(prisma));

  async findOrganizationIdByProject(projectId: string): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: organizationSelect,
    });

    return project?.team?.organizationId ?? null;
  }

  async findAllResourceGrantIds({
    organizationId,
    projectId,
    id,
    resourceKind,
    resourceId,
  }: ShareGrantScope): Promise<string[]> {
    const rows = await this.prisma.grant.findMany({
      where: {
        // Every grant read carries its organisation tenancy fence.
        organizationId,
        revokedAt: null,
        projectId,
        scopeType: "RESOURCE",
        ...(id !== void 0 ? { id } : {}),
        ...(resourceKind !== void 0 ? { resourceKind } : {}),
        ...(resourceId !== void 0 ? { scopeId: resourceId } : {}),
      },
      select: idSelect,
    });

    return rows.map((row) => row.id);
  }

  /**
   * Atomically consume and mirror a view. A unique failure distinguishes a
   * concurrent first view and retries the cap once in a fresh transaction.
   */
  async consumeUsage(params: ConsumeShareUsageParams): Promise<boolean> {
    try {
      return await this.transaction((tx) => this.#consumeOrOpen(tx, params));
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      // The conflicting transaction created the row; retry the cap once.
      return this.transaction(async (tx) => {
        if (!(await incrementUsage(tx, params))) return false;
        await mirrorUsage(tx, params);
        return true;
      });
    }
  }

  /** Increment the usage row, or open it at one when this is the first view. */
  async #consumeOrOpen(tx: UsageTransaction, params: ConsumeShareUsageParams): Promise<boolean> {
    if (await incrementUsage(tx, params)) {
      await mirrorUsage(tx, params);
      return true;
    }
    // A non-positive cap must not enter through the first-view create.
    if (params.maxViews != null && params.maxViews <= 0) return false;

    await tx.grantUsage.create({
      data: {
        grantId: params.grantId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        viewCount: 1,
        lastViewedAt: toDate(nowInstant()),
      },
    });
    await mirrorUsage(tx, params);

    return true;
  }
}

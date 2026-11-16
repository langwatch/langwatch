import { type PrismaModelClient, prismaTables, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { type Instant, fromDate, toDate } from "@langwatch/time";

import type {
  StoredObjectOwnerLink,
  StoredObjectOwnerLinkRepository,
} from "../stored-object-owner-link.repository.ts";

/** The link rows, plus the raw SQL the sweep's tenant list and the re-time need. */
type PrismaStoredObjectOwnerLinkDatabase = PrismaModelClient<"StoredObjectOwner"> &
  Pick<PrismaClient, "$executeRaw" | "$queryRaw">;

export class PrismaStoredObjectOwnerLinkRepository implements StoredObjectOwnerLinkRepository {
  /** Declared, not inherited: the model-scoped client carries no `$executeRaw`. */
  static readonly tables = prismaTables("StoredObjectOwner");

  static create({
    prisma,
  }: {
    prisma: PrismaStoredObjectOwnerLinkDatabase;
  }): PrismaStoredObjectOwnerLinkRepository {
    return new PrismaStoredObjectOwnerLinkRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaStoredObjectOwnerLinkDatabase) {}

  /**
   * An insert that skips an existing key, then a raise conditional on the
   * stored end being earlier: each statement is atomic, so concurrent raises
   * settle on the latest end and none lowers another.
   */
  async raise(link: StoredObjectOwnerLink): Promise<void> {
    const retainUntil = link.retainUntil ? toDate(link.retainUntil) : null;
    const { count } = await this.prisma.storedObjectOwner.createMany({
      data: [
        {
          tenantId: link.tenantId,
          objectId: link.objectId,
          ownerKind: link.ownerKind,
          ownerId: link.ownerId,
          retainUntil,
          createdAt: toDate(link.createdAt),
          updatedAt: toDate(link.updatedAt),
        },
      ],
      skipDuplicates: true,
    });
    if (count > 0) return;

    await this.prisma.storedObjectOwner.updateMany({
      where: {
        tenantId: link.tenantId,
        objectId: link.objectId,
        ownerKind: link.ownerKind,
        ownerId: link.ownerId,
        retainUntil: retainUntil === null ? { not: null } : { lt: retainUntil },
      },
      data: { retainUntil, updatedAt: toDate(link.updatedAt) },
    });
  }

  async countLive(input: {
    tenantId: StoredObjectProjectId;
    objectId: StoredObjectId;
    now: Instant;
  }): Promise<number> {
    return this.prisma.storedObjectOwner.count({
      where: {
        tenantId: input.tenantId,
        objectId: input.objectId,
        OR: [{ retainUntil: null }, { retainUntil: { gt: toDate(input.now) } }],
      },
    });
  }

  async deleteForTenant(input: { tenantId: StoredObjectProjectId }): Promise<void> {
    await this.prisma.storedObjectOwner.deleteMany({ where: { tenantId: input.tenantId } });
  }

  async findTenantsWithExpired(input: {
    before: Instant;
    limit: number;
  }): Promise<StoredObjectProjectId[]> {
    const rows = await this.prisma.$queryRaw<{ tenantId: string }[]>`
      ${skipTenantCheck({
        // The retention sweep's tenant list: every tenant with an ended link, bounded.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT DISTINCT "tenantId"
        FROM "StoredObjectOwner"
       WHERE "retainUntil" <= ${toDate(input.before)}
       ORDER BY "tenantId"
       LIMIT ${input.limit}
    `;

    return rows.map((row) => row.tenantId as StoredObjectProjectId);
  }

  async findExpired(input: {
    tenantId: StoredObjectProjectId;
    before: Instant;
    limit: number;
  }): Promise<StoredObjectOwnerLink[]> {
    const rows = await this.prisma.storedObjectOwner.findMany({
      where: { tenantId: input.tenantId, retainUntil: { lte: toDate(input.before) } },
      orderBy: [{ objectId: "asc" }, { ownerKind: "asc" }, { ownerId: "asc" }],
      take: input.limit,
    });

    return rows.map((row) => ({
      tenantId: row.tenantId as StoredObjectProjectId,
      objectId: row.objectId as StoredObjectId,
      ownerKind: row.ownerKind,
      ownerId: row.ownerId,
      retainUntil: row.retainUntil ? fromDate(row.retainUntil) : null,
      createdAt: fromDate(row.createdAt),
      updatedAt: fromDate(row.updatedAt),
    }));
  }

  async deleteExpired(input: {
    tenantId: StoredObjectProjectId;
    objectIds: readonly StoredObjectId[];
    before: Instant;
  }): Promise<number> {
    if (input.objectIds.length === 0) return 0;
    const { count } = await this.prisma.storedObjectOwner.deleteMany({
      where: {
        tenantId: input.tenantId,
        objectId: { in: [...input.objectIds] },
        retainUntil: { lte: toDate(input.before) },
      },
    });

    return count;
  }

  /** `createdAt` plus whole days, in one statement over the page's objects. */
  async retime(input: {
    tenantId: StoredObjectProjectId;
    objectIds: readonly StoredObjectId[];
    days: number | null;
    at: Instant;
  }): Promise<void> {
    if (input.objectIds.length === 0) return;
    if (input.days === null) {
      await this.prisma.storedObjectOwner.updateMany({
        where: { tenantId: input.tenantId, objectId: { in: [...input.objectIds] } },
        data: { retainUntil: null, updatedAt: toDate(input.at) },
      });
      return;
    }

    await this.prisma.$executeRaw`
      UPDATE "StoredObjectOwner"
         SET "retainUntil" = "createdAt" + make_interval(days => ${input.days}::int),
             "updatedAt" = ${toDate(input.at)}
       WHERE "tenantId" = ${input.tenantId}
         AND "objectId" = ANY(${[...input.objectIds]}::text[])
    `;
  }
}

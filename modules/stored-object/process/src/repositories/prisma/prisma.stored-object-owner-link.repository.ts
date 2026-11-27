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
   * One upsert, atomic per key: concurrent raises settle on the latest end and none lowers
   * another. A null end on either side holds with no end; `createdAt` always moves to the
   * latest store, so a re-time counts from it (ADR-002 §5).
   */
  async raise(link: StoredObjectOwnerLink): Promise<void> {
    const retainUntil = link.retainUntil ? utcTimestamp(link.retainUntil) : null;
    await this.prisma.$executeRaw`
      INSERT INTO "StoredObjectOwner"
        ("tenantId", "objectId", "ownerKind", "ownerId", "retainUntil", "createdAt", "updatedAt")
      VALUES (
        ${link.tenantId}, ${link.objectId}, ${link.ownerKind}, ${link.ownerId},
        ${retainUntil}::timestamp, ${utcTimestamp(link.createdAt)}::timestamp,
        ${utcTimestamp(link.updatedAt)}::timestamp
      )
      ON CONFLICT ("tenantId", "objectId", "ownerKind", "ownerId") DO UPDATE SET
        "retainUntil" = CASE
          WHEN "StoredObjectOwner"."retainUntil" IS NULL OR EXCLUDED."retainUntil" IS NULL
            THEN NULL
          ELSE GREATEST("StoredObjectOwner"."retainUntil", EXCLUDED."retainUntil")
        END,
        "createdAt" = GREATEST("StoredObjectOwner"."createdAt", EXCLUDED."createdAt"),
        "updatedAt" = EXCLUDED."updatedAt"
    `;
  }

  async countAll(input: {
    tenantId: StoredObjectProjectId;
    objectId: StoredObjectId;
  }): Promise<number> {
    return this.prisma.storedObjectOwner.count({
      where: { tenantId: input.tenantId, objectId: input.objectId },
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
      SELECT "tenantId"
        FROM "StoredObjectOwner"
       WHERE "retainUntil" <= ${toDate(input.before)}
       GROUP BY "tenantId"
       ORDER BY MIN("retainUntil"), "tenantId"
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
    keepingLastLink?: boolean;
  }): Promise<number> {
    if (input.objectIds.length === 0) return 0;
    if (input.keepingLastLink === true) {
      // A live link the statement's snapshot sees is not ended, so it is never removed here.
      return this.prisma.$executeRaw`
        DELETE FROM "StoredObjectOwner" AS l
         WHERE l."tenantId" = ${input.tenantId}
           AND l."objectId" = ANY(${[...input.objectIds]}::text[])
           AND l."retainUntil" <= ${toDate(input.before)}
           AND EXISTS (
             SELECT 1
               FROM "StoredObjectOwner" AS live
              WHERE live."tenantId" = l."tenantId"
                AND live."objectId" = l."objectId"
                AND (live."retainUntil" IS NULL OR live."retainUntil" > ${toDate(input.before)})
           )
      `;
    }
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
    onlyLater?: boolean;
    at: Instant;
  }): Promise<void> {
    if (input.objectIds.length === 0) return;
    if (input.onlyLater === true && input.days !== null) {
      await this.prisma.$executeRaw`
        UPDATE "StoredObjectOwner"
           SET "retainUntil" = "createdAt" + make_interval(days => ${input.days}::int),
               "updatedAt" = ${toDate(input.at)}
         WHERE "tenantId" = ${input.tenantId}
           AND "objectId" = ANY(${[...input.objectIds]}::text[])
           AND "retainUntil" < "createdAt" + make_interval(days => ${input.days}::int)
      `;
      return;
    }
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

/** A naive UTC literal: a bound `Date` would go through the session time zone (`timestamp(3)`). */
function utcTimestamp(instant: Instant): string {
  return instant.toString({ fractionalSecondDigits: 3 }).replace(/Z$/, "");
}

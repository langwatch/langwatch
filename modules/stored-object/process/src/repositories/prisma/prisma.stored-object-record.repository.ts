import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { prismaTables } from "@langwatch/prisma-client/ownership";
import type {
  StoredObjectDeliveryAudience,
  StoredObjectId,
  StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import { type Instant, Temporal, fromDate, toDate, toEpochMs } from "@langwatch/time";

import type {
  StoredObjectRecord,
  StoredObjectRecordPageQuery,
  StoredObjectRecordRepository,
  StoredObjectRecordStatus,
  StoredObjectSource,
} from "../stored-object-record.repository.ts";

/** The model delegate, and raw SQL for the tenant sweep, the guarded transition, the
 * conditional delete and the audience append. */
type StoredObjectRecordDatabase = Pick<PrismaClient, "storedObject" | "$queryRaw" | "$executeRaw">;

/**
 * Declared rather than inherited from `PrismaRepository.for`: the raw SQL here needs
 * `$queryRaw` and `$executeRaw`, which that base class's model-scoped client has not.
 */
export class PrismaStoredObjectRecordRepository implements StoredObjectRecordRepository {
  static readonly tables = prismaTables("StoredObject", "StoredObjectOwner");

  static create({
    prisma,
  }: {
    prisma: StoredObjectRecordDatabase;
  }): PrismaStoredObjectRecordRepository {
    return new PrismaStoredObjectRecordRepository(prisma);
  }

  private constructor(private readonly prisma: StoredObjectRecordDatabase) {}

  async findById(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
  }): Promise<StoredObjectRecord | null> {
    const value = await this.prisma.storedObject.findUnique({
      where: { tenantId_id: { tenantId: input.tenantId, id: input.id } },
    });

    return value ? fromRow(value) : null;
  }

  async upsert(value: StoredObjectRecord): Promise<void> {
    const row = toRow(value);

    await this.prisma.storedObject.upsert({
      where: { tenantId_id: { tenantId: value.tenantId, id: value.id } },
      create: row,
      update: row,
    });
  }

  async insert(value: StoredObjectRecord): Promise<boolean> {
    const result = await this.prisma.storedObject.createMany({
      data: [toRow(value)],
      skipDuplicates: true,
    });

    return result.count === 1;
  }

  /**
   * SQL, not `updateMany`: Prisma compiles that to an id subquery, and a racing write parked on
   * the row lock re-checks only the id, so a confirm and the reaper could both win.
   */
  async transition(input: {
    expected: Pick<StoredObjectRecord, "status" | "generation">;
    next: StoredObjectRecord;
  }): Promise<boolean> {
    const row = toRow(input.next);
    const updated = await this.prisma.$executeRaw`
      UPDATE "StoredObject"
         SET "status" = ${row.status},
             "purpose" = ${row.purpose},
             "ownerKind" = ${row.ownerKind},
             "ownerId" = ${row.ownerId},
             "filename" = ${row.filename},
             "sha256" = ${row.sha256},
             "sizeBytes" = ${row.sizeBytes},
             "mediaType" = ${row.mediaType},
             "mediaTypeVerified" = ${row.mediaTypeVerified},
             "storageProvider" = ${row.storageProvider},
             "storageDestinationId" = ${row.storageDestinationId},
             "storageProviderRelativeId" = ${row.storageProviderRelativeId},
             "generation" = ${row.generation},
             "audiences" = ${JSON.stringify(row.audiences)}::jsonb,
             "expiresAt" = ${row.expiresAt},
             "availableAt" = ${row.availableAt},
             "deletedAt" = ${row.deletedAt},
             "source" = ${row.source},
             "legacyFingerprint" = ${row.legacyFingerprint},
             "createdAt" = ${row.createdAt},
             "updatedAt" = ${row.updatedAt}
       WHERE "tenantId" = ${row.tenantId}
         AND "id" = ${row.id}
         AND "status" = ${input.expected.status}
         AND "generation" = ${input.expected.generation}
    `;

    return updated === 1;
  }

  async countActive(input: {
    tenantId: StoredObjectProjectId;
    purpose?: string;
  }): Promise<{ activeObjectCount: number; activeByteLength: number }> {
    const result = await this.prisma.storedObject.aggregate({
      where: {
        tenantId: input.tenantId,
        status: "available",
        ...(input.purpose ? { purpose: input.purpose } : {}),
      },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });

    return {
      activeObjectCount: result._count._all,
      activeByteLength: Number(result._sum.sizeBytes ?? 0),
    };
  }

  async findPage(input: StoredObjectRecordPageQuery): Promise<StoredObjectRecord[]> {
    const rows = await this.prisma.storedObject.findMany({
      where: {
        tenantId: input.tenantId,
        ...(input.afterId ? { id: { gt: input.afterId } } : {}),
        ...(input.status === undefined
          ? {}
          : {
              status: typeof input.status === "string" ? input.status : { in: [...input.status] },
            }),
        ...(input.purpose ? { purpose: input.purpose } : {}),
        ...(input.expiresBefore ? { expiresAt: { lte: toDate(input.expiresBefore) } } : {}),
      },
      orderBy: { id: "asc" },
      take: input.limit,
    });

    return rows.map((row) => fromRow(row));
  }

  async findReusable(input: {
    tenantId: StoredObjectProjectId;
    purpose: string;
    sha256: string;
    mediaType: string;
    limit: number;
  }): Promise<StoredObjectRecord[]> {
    const rows = await this.prisma.storedObject.findMany({
      where: {
        tenantId: input.tenantId,
        purpose: input.purpose,
        sha256: input.sha256,
        mediaType: input.mediaType,
        status: "available",
      },
      orderBy: { id: "asc" },
      take: input.limit,
    });

    return rows.map((row) => fromRow(row));
  }

  async findPageByPurpose(input: {
    purpose: string;
    after?: Readonly<{ tenantId: StoredObjectProjectId; id: StoredObjectId }>;
    limit: number;
  }): Promise<StoredObjectRecord[]> {
    const { after } = input;
    const rows = await this.prisma.storedObject.findMany({
      where: {
        purpose: input.purpose,
        ...(after
          ? {
              OR: [
                { tenantId: { gt: after.tenantId } },
                { tenantId: after.tenantId, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ tenantId: "asc" }, { id: "asc" }],
      take: input.limit,
    });

    return rows.map((row) => fromRow(row));
  }

  async findTenantsWithExpiredUploads(input: {
    expiresBefore: Instant;
    afterTenantId?: StoredObjectProjectId;
    limit: number;
  }): Promise<StoredObjectProjectId[]> {
    const rows = await this.prisma.$queryRaw<{ tenantId: string }[]>`
      ${skipTenantCheck({
        // Fleet-wide reap of abandoned uploads; each project is cleaned by its own scoped reads.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT DISTINCT "tenantId"
        FROM "StoredObject"
       WHERE "expiresAt" <= ${toDate(input.expiresBefore)}
         AND (
           "status" IN ('pending', 'uploading')
           OR ("status" IN ('failed', 'deleted') AND "storageProvider" IS NOT NULL)
         )
         AND "tenantId" > ${input.afterTenantId ?? ""}
       ORDER BY "tenantId"
       LIMIT ${input.limit}
    `;

    return rows.map((row) => row.tenantId as StoredObjectProjectId);
  }

  async delete(input: { tenantId: StoredObjectProjectId; id: StoredObjectId }): Promise<void> {
    await this.prisma.storedObject.deleteMany({
      where: { tenantId: input.tenantId, id: input.id },
    });
  }

  /** One UPDATE whose NOT EXISTS reads the owner links, so no live link is missed between them. */
  async markDeletedIfUnheld(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
    now: Instant;
  }): Promise<boolean> {
    const now = toDate(input.now);
    const count = await this.prisma.$executeRaw`
      UPDATE "StoredObject" AS o
         SET "status" = 'deleted',
             "generation" = o."generation" + 1,
             "deletedAt" = ${now},
             "expiresAt" = ${now},
             "updatedAt" = ${now}
       WHERE o."tenantId" = ${input.tenantId}
         AND o."id" = ${input.id}
         AND o."status" = 'available'
         AND NOT EXISTS (
           SELECT 1
             FROM "StoredObjectOwner" AS l
            WHERE l."tenantId" = o."tenantId"
              AND l."objectId" = o."id"
              AND (l."retainUntil" IS NULL OR l."retainUntil" > ${now})
         )
    `;

    return count > 0;
  }

  /** A jsonb append conditional on the row: no read-modify-write a delete could overtake. */
  async addAudience(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
    audience: StoredObjectDeliveryAudience;
    at: Instant;
  }): Promise<void> {
    const audience = JSON.stringify([input.audience]);
    await this.prisma.$executeRaw`
      UPDATE "StoredObject"
         SET "audiences" = "audiences" || ${audience}::jsonb,
             "updatedAt" = ${toDate(input.at)}
       WHERE "tenantId" = ${input.tenantId}
         AND "id" = ${input.id}
         AND "status" = 'available'
         AND NOT ("audiences" @> ${audience}::jsonb)
    `;
  }
}

interface StoredObjectRow {
  tenantId: string;
  id: string;
  status: string;
  purpose: string;
  ownerKind: string;
  ownerId: string;
  filename: string;
  sha256: string;
  sizeBytes: bigint;
  mediaType: string;
  mediaTypeVerified: boolean;
  storageProvider: string | null;
  storageDestinationId: string | null;
  storageProviderRelativeId: string | null;
  generation: number;
  audiences: string[];
  expiresAt: Date | null;
  availableAt: Date | null;
  deletedAt: Date | null;
  source: string;
  legacyFingerprint: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRow(value: StoredObjectRecord): StoredObjectRow {
  return {
    tenantId: value.tenantId,
    id: value.id,
    status: value.status,
    purpose: value.purpose,
    ownerKind: value.ownerKind,
    ownerId: value.ownerId,
    filename: value.filename,
    sha256: value.sha256,
    sizeBytes: BigInt(value.byteLength),
    mediaType: value.mediaType,
    mediaTypeVerified: value.mediaTypeVerified,
    storageProvider: value.storage?.provider ?? null,
    storageDestinationId: value.storage?.destinationId ?? null,
    storageProviderRelativeId: value.storage?.relativeId ?? null,
    generation: value.generation,
    audiences: [...value.audiences],
    expiresAt: value.expiresAt ? toDate(value.expiresAt) : null,
    availableAt: value.availableAt ? toDate(value.availableAt) : null,
    deletedAt: value.deletedAt ? toDate(value.deletedAt) : null,
    source: value.source,
    legacyFingerprint: value.legacyFingerprint,
    createdAt: toDate(value.createdAt),
    updatedAt: toDate(value.updatedAt),
  };
}

function fromRow(value: unknown): StoredObjectRecord {
  const row = record(value);
  const provider = findString(row.storageProvider);
  const destinationId = findString(row.storageDestinationId);
  const relativeId = findString(row.storageProviderRelativeId);

  return {
    tenantId: string(row.tenantId, "tenantId") as StoredObjectProjectId,
    id: string(row.id, "id") as StoredObjectId,
    status: string(row.status, "status") as StoredObjectRecordStatus,
    purpose: string(row.purpose, "purpose"),
    ownerKind: string(row.ownerKind, "ownerKind"),
    ownerId: string(row.ownerId, "ownerId"),
    filename: string(row.filename, "filename"),
    sha256: string(row.sha256, "sha256"),
    byteLength: Number(row.sizeBytes),
    mediaType: string(row.mediaType, "mediaType"),
    mediaTypeVerified: row.mediaTypeVerified === true,
    storage:
      provider && destinationId && relativeId ? { provider, destinationId, relativeId } : null,
    generation: Number(row.generation),
    audiences: stringArray(row.audiences) as StoredObjectDeliveryAudience[],
    expiresAt: findDate(row.expiresAt),
    availableAt: findDate(row.availableAt),
    deletedAt: findDate(row.deletedAt),
    source: string(row.source, "source") as StoredObjectSource,
    legacyFingerprint: findString(row.legacyFingerprint),
    createdAt: date(row.createdAt, "createdAt"),
    updatedAt: date(row.updatedAt, "updatedAt"),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("StoredObject row is invalid");
  }

  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") throw new TypeError(`StoredObject.${field} is invalid`);

  return value;
}

function findString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function date(value: unknown, field: string): Instant {
  if (value instanceof Date) return fromDate(value);
  if (typeof value === "string" || typeof value === "number") {
    return Temporal.Instant.fromEpochMilliseconds(toEpochMs(value));
  }

  throw new TypeError(`StoredObject.${field} is invalid`);
}

function findDate(value: unknown): Instant | null {
  return value === null || value === undefined ? null : date(value, "date");
}

import type {
  StoredObjectDeliveryAudience,
  StoredObjectId,
  StoredObjectLifecycleStatus,
  StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { type Instant, Temporal, fromDate, toDate, toEpochMs } from "@langwatch/time";
import type {
  StoredObjectRecord,
  StoredObjectRecordPageQuery,
  StoredObjectRecordRepository,
  StoredObjectSource,
} from "../stored-object-record.repository.ts";

export class PrismaStoredObjectRecordRepository
  extends PrismaRepository.for("StoredObject")
  implements StoredObjectRecordRepository
{
  static readonly create = this.factory((prisma) => new PrismaStoredObjectRecordRepository(prisma));

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
        ...(input.status ? { status: input.status } : {}),
        ...(input.expiresBefore ? { expiresAt: { lte: toDate(input.expiresBefore) } } : {}),
      },
      orderBy: { id: "asc" },
      take: input.limit,
    });

    return rows.map((row) => fromRow(row));
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
    status: string(row.status, "status") as StoredObjectLifecycleStatus,
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

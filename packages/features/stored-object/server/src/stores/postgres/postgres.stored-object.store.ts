import type {
  StoredObjectDeliveryAudience,
  StoredObjectId,
  StoredObjectLifecycleStatus,
  StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import {
  StoredObjectStore,
  type StoredObjectRecord,
  type StoredObjectSource,
} from "../stored-object.store";

type StoredObjectDelegate = {
  findUnique(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  aggregate(args: unknown): Promise<unknown>;
  upsert(args: unknown): Promise<unknown>;
};

export type StoredObjectDatabase = Readonly<{
  storedObject: StoredObjectDelegate;
}>;

/** Prisma-compatible adapter; generated Prisma values never leave this file. */
export class PostgresStoredObjectStore extends StoredObjectStore {
  static create(database: StoredObjectDatabase): PostgresStoredObjectStore {
    return new PostgresStoredObjectStore(database);
  }

  private constructor(private readonly database: StoredObjectDatabase) {
    super();
  }

  async tryFind(input: {
    tenantId: StoredObjectProjectId;
    id: StoredObjectId;
  }): Promise<StoredObjectRecord | null> {
    const value = await this.database.storedObject.findUnique({
      where: { tenantId_id: input },
    });
    return value ? this.fromRow(value) : null;
  }

  async save(value: StoredObjectRecord): Promise<void> {
    const row = this.toRow(value);
    await this.database.storedObject.upsert({
      where: { tenantId_id: { tenantId: value.tenantId, id: value.id } },
      create: row,
      update: row,
    });
  }

  async getUsage(input: {
    tenantId: StoredObjectProjectId;
    purpose?: string;
  }): Promise<{ activeObjectCount: number; activeByteLength: number }> {
    const where: Record<string, unknown> = {
      tenantId: input.tenantId,
      status: "available",
    };
    if (input.purpose) where.purpose = input.purpose;
    const result = (await this.database.storedObject.aggregate({
      where,
      _count: { _all: true },
      _sum: { sizeBytes: true },
    })) as {
      _count?: { _all?: number };
      _sum?: { sizeBytes?: bigint | number | null };
    };
    return {
      activeObjectCount: result._count?._all ?? 0,
      activeByteLength: Number(result._sum?.sizeBytes ?? 0),
    };
  }

  async findPage(input: {
    tenantId: StoredObjectProjectId;
    afterId?: StoredObjectId;
    status?: StoredObjectLifecycleStatus;
    expiresBefore?: Date;
    limit: number;
  }): Promise<StoredObjectRecord[]> {
    const where: Record<string, unknown> = { tenantId: input.tenantId };
    if (input.afterId) where.id = { gt: input.afterId };
    if (input.status) where.status = input.status;
    if (input.expiresBefore) where.expiresAt = { lte: input.expiresBefore };
    const rows = await this.database.storedObject.findMany({
      where,
      orderBy: { id: "asc" },
      take: input.limit,
    });
    return rows.map((row) => this.fromRow(row));
  }

  private toRow(value: StoredObjectRecord): Record<string, unknown> {
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
      expiresAt: value.expiresAt,
      availableAt: value.availableAt,
      deletedAt: value.deletedAt,
      source: value.source,
      legacyFingerprint: value.legacyFingerprint,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    };
  }

  private fromRow(value: unknown): StoredObjectRecord {
    const row = this.record(value);
    const provider = this.tryString(row.storageProvider);
    const destinationId = this.tryString(row.storageDestinationId);
    const relativeId = this.tryString(row.storageProviderRelativeId);
    return {
      tenantId: this.string(row.tenantId, "tenantId") as StoredObjectProjectId,
      id: this.string(row.id, "id") as StoredObjectId,
      status: this.string(row.status, "status") as StoredObjectLifecycleStatus,
      purpose: this.string(row.purpose, "purpose"),
      ownerKind: this.string(row.ownerKind, "ownerKind"),
      ownerId: this.string(row.ownerId, "ownerId"),
      filename: this.string(row.filename, "filename"),
      sha256: this.string(row.sha256, "sha256"),
      byteLength: Number(row.sizeBytes),
      mediaType: this.string(row.mediaType, "mediaType"),
      mediaTypeVerified: row.mediaTypeVerified === true,
      storage:
        provider && destinationId && relativeId ? { provider, destinationId, relativeId } : null,
      generation: Number(row.generation),
      audiences: this.stringArray(row.audiences) as StoredObjectDeliveryAudience[],
      expiresAt: this.tryDate(row.expiresAt),
      availableAt: this.tryDate(row.availableAt),
      deletedAt: this.tryDate(row.deletedAt),
      source: this.string(row.source, "source") as StoredObjectSource,
      legacyFingerprint: this.tryString(row.legacyFingerprint),
      createdAt: this.date(row.createdAt, "createdAt"),
      updatedAt: this.date(row.updatedAt, "updatedAt"),
    };
  }

  private record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("StoredObject row is invalid");
    }
    return value as Record<string, unknown>;
  }

  private string(value: unknown, field: string): string {
    if (typeof value !== "string") {
      throw new TypeError(`StoredObject.${field} is invalid`);
    }
    return value;
  }

  private tryString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private date(value: unknown, field: string): Date {
    if (value instanceof Date) return value;
    if (typeof value === "string" || typeof value === "number") {
      return new Date(value);
    }
    throw new TypeError(`StoredObject.${field} is invalid`);
  }

  private tryDate(value: unknown): Date | null {
    return value === null || value === undefined ? null : this.date(value, "date");
  }
}

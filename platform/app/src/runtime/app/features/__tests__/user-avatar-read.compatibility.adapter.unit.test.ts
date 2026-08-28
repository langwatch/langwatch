import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { StoredObjectId } from "@langwatch/stored-object-contract";
import {
  StoredObjectDeliveryPort,
  StoredObjectService,
  StoredObjectStoragePort,
  StoredObjectUploadTokenPort,
} from "@langwatch/stored-object-server";
import { InMemoryStoredObjectStore } from "@langwatch/stored-object-server/testing";
import { describe, expect, it, vi } from "vitest";
import { AppUserAvatarReadCompatibilityAdapter } from "../user-avatar-read.compatibility.adapter";
import { StorageRegistry } from "~/server/stored-objects/storage-registry";
import { StoredObjectsRepository } from "~/server/stored-objects/stored-objects.repository";
import { StoredObjectsService } from "~/server/stored-objects/stored-objects.service";
import type { StorageDriver } from "~/server/stored-objects/storage-driver";

class MemoryCanonicalStorage extends StoredObjectStoragePort {
  private readonly values = new Map<string, Uint8Array>();

  clear(): void {
    this.values.clear();
  }

  async write(input: {
    projectId: string;
    objectId: string;
    bytes: Uint8Array;
    mediaType: string;
  }) {
    const address = {
      provider: "memory",
      destinationId: input.projectId,
      relativeId: input.objectId,
    };
    this.values.set(this.key(address), input.bytes);
    return address;
  }

  async tryCreateUpload() {
    return null;
  }

  async tryStat(input: {
    projectId: string;
    address: { provider: string; destinationId: string; relativeId: string };
  }) {
    const bytes = this.values.get(this.key(input.address));
    if (!bytes) return null;
    return {
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async tryRead(input: {
    projectId: string;
    address: { provider: string; destinationId: string; relativeId: string };
  }) {
    const bytes = this.values.get(this.key(input.address));
    return bytes ? Readable.from([bytes]) : null;
  }

  async delete(input: {
    projectId: string;
    address: { provider: string; destinationId: string; relativeId: string };
  }) {
    this.values.delete(this.key(input.address));
  }

  private key(input: { provider: string; destinationId: string; relativeId: string }): string {
    return `${input.provider}:${input.destinationId}:${input.relativeId}`;
  }
}

class UnavailableDelivery extends StoredObjectDeliveryPort {
  async mint(): Promise<never> {
    throw new Error("not used in avatar read tests");
  }
}

class UnavailableUploadTokens extends StoredObjectUploadTokenPort {
  async encode(): Promise<never> {
    throw new Error("not used in avatar read tests");
  }

  async decode(): Promise<never> {
    throw new Error("not used in avatar read tests");
  }
}

class Sha256IdDeriver {
  fromDigest(input: { projectId: string; sha256: string }): StoredObjectId {
    return input.sha256;
  }
}

class UnusedDriver implements StorageDriver {
  async get(): Promise<Readable> {
    throw new Error("not used in avatar read tests");
  }

  async put(): Promise<void> {
    throw new Error("not used in avatar read tests");
  }

  async delete(): Promise<void> {
    throw new Error("not used in avatar read tests");
  }

  async exists(): Promise<boolean> {
    throw new Error("not used in avatar read tests");
  }
}

function canonical() {
  const storage = new MemoryCanonicalStorage();
  return {
    service: StoredObjectService.create({
      store: InMemoryStoredObjectStore.create(),
      storage,
      delivery: new UnavailableDelivery(),
      uploadTokens: new UnavailableUploadTokens(),
      idDeriver: new Sha256IdDeriver(),
      maximumUploadBytes: 8 * 1024 * 1024,
      uploadExpiryMs: 60_000,
    }),
    storage,
  };
}

function historical() {
  const driver = new UnusedDriver();
  return StoredObjectsService.create(
    new StoredObjectsRepository(),
    () => new StorageRegistry({ s3: driver, file: driver }),
  );
}

describe("AppUserAvatarReadCompatibilityAdapter", () => {
  it("reads a canonical avatar without touching the retired ClickHouse service", async () => {
    const { service } = canonical();
    const legacy = historical();
    const legacyRead = vi.spyOn(legacy, "getById");
    const stored = await service.storeFromBytes({
      projectId: "project_1",
      purpose: "user_avatar",
      ownerKind: "user",
      ownerId: "user_1",
      filename: "avatar",
      mediaType: "image/png",
      audience: "project:view",
      bytes: new Uint8Array([1, 2, 3]),
    });
    const adapter = AppUserAvatarReadCompatibilityAdapter.create({
      canonical: service,
      historical: legacy,
    });

    const result = await adapter.getById({
      projectId: "project_1",
      id: stored.reference.id,
    });

    expect(result).toMatchObject({
      status: "available",
      metadata: {
        byteLength: 3,
        mediaType: "image/png",
        purpose: "user_avatar",
        ownerKind: "user",
      },
    });
    if (!result || result.status !== "available") {
      throw new Error("expected canonical avatar bytes");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
    expect(legacyRead).not.toHaveBeenCalled();
  });

  it("uses the retired read path only when no canonical record exists", async () => {
    const legacy = historical();
    const legacyRead = vi.spyOn(legacy, "getById").mockResolvedValue({
      row: {
        id: "historic_avatar",
        project_id: "project_1",
        purpose: "user_avatar",
        owner_kind: "user",
        owner_id: "user_1",
        media_type: "image/jpeg",
        size_bytes: 2,
        sha256: "a".repeat(64),
        storage_uri: "s3://historic/project_1/historic_avatar",
        created_at: new Date("2025-01-01T00:00:00.000Z"),
        inserted_at: new Date("2025-01-01T00:00:00.000Z"),
      },
      stream: Readable.from([new Uint8Array([4, 5])]),
    });
    const adapter = AppUserAvatarReadCompatibilityAdapter.create({
      canonical: canonical().service,
      historical: legacy,
    });

    const result = await adapter.getById({ projectId: "project_1", id: "historic_avatar" });

    expect(result).toMatchObject({
      status: "available",
      metadata: {
        byteLength: 2,
        mediaType: "image/jpeg",
        purpose: "user_avatar",
        ownerKind: "user",
      },
    });
    if (!result || result.status !== "available") {
      throw new Error("expected historical avatar bytes");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([4, 5]));
    expect(legacyRead).toHaveBeenCalledOnce();
  });

  it("maps historical rows without bytes to the legacy missing response", async () => {
    const legacy = historical();
    vi.spyOn(legacy, "getById").mockResolvedValue({
      row: {
        id: "historic_missing_avatar",
        project_id: "project_1",
        purpose: "user_avatar",
        owner_kind: "user",
        owner_id: "user_1",
        media_type: "image/png",
        size_bytes: 3,
        sha256: "b".repeat(64),
        storage_uri: "s3://historic/project_1/historic_missing_avatar",
        created_at: new Date("2025-01-01T00:00:00.000Z"),
        inserted_at: new Date("2025-01-01T00:00:00.000Z"),
      },
      status: "missing",
    });
    const adapter = AppUserAvatarReadCompatibilityAdapter.create({
      canonical: canonical().service,
      historical: legacy,
    });

    await expect(
      adapter.getById({ projectId: "project_1", id: "historic_missing_avatar" }),
    ).resolves.toEqual({
      status: "missing",
      metadata: {
        byteLength: 3,
        mediaType: "image/png",
        purpose: "user_avatar",
        ownerKind: "user",
      },
    });
  });

  it("keeps the historical missing-byte response for a canonical row without bytes", async () => {
    const { service, storage } = canonical();
    const legacy = historical();
    const legacyRead = vi.spyOn(legacy, "getById");
    const stored = await service.storeFromBytes({
      projectId: "project_1",
      purpose: "user_avatar",
      ownerKind: "user",
      ownerId: "user_1",
      filename: "avatar",
      mediaType: "image/png",
      audience: "project:view",
      bytes: new Uint8Array([1]),
    });
    storage.clear();
    const adapter = AppUserAvatarReadCompatibilityAdapter.create({
      canonical: service,
      historical: legacy,
    });

    await expect(
      adapter.getById({ projectId: "project_1", id: stored.reference.id }),
    ).resolves.toMatchObject({
      status: "missing",
      metadata: {
        mediaType: "image/png",
        purpose: "user_avatar",
        ownerKind: "user",
      },
    });
    expect(legacyRead).not.toHaveBeenCalled();
  });

  it("does not hide a canonical lifecycle failure behind the historical fallback", async () => {
    const { service } = canonical();
    const legacy = historical();
    const legacyRead = vi.spyOn(legacy, "getById");
    const stored = await service.storeFromBytes({
      projectId: "project_1",
      purpose: "user_avatar",
      ownerKind: "user",
      ownerId: "user_1",
      filename: "avatar",
      mediaType: "image/png",
      audience: "project:view",
      bytes: new Uint8Array([1]),
    });
    await service.delete({
      projectId: "project_1",
      id: stored.reference.id,
      idempotencyKey: "avatar-delete",
    });
    const adapter = AppUserAvatarReadCompatibilityAdapter.create({
      canonical: service,
      historical: legacy,
    });

    await expect(
      adapter.getById({ projectId: "project_1", id: stored.reference.id }),
    ).rejects.toThrow("stored object was deleted");
    expect(legacyRead).not.toHaveBeenCalled();
  });

  it("falls back only for canonical not-found errors", async () => {
    const { service } = canonical();
    const legacy = historical();
    const legacyRead = vi.spyOn(legacy, "getById");
    vi.spyOn(service, "getById").mockRejectedValue(new Error("storage unavailable"));
    const adapter = AppUserAvatarReadCompatibilityAdapter.create({
      canonical: service,
      historical: legacy,
    });

    await expect(
      adapter.getById({ projectId: "project_1", id: "unavailable_avatar" }),
    ).rejects.toThrow("storage unavailable");
    expect(legacyRead).not.toHaveBeenCalled();
  });
});

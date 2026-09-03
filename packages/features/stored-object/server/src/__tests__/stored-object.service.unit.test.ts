import type {
  StoredObjectDeliveryCapability,
  StoredObjectDirectUploadTarget,
} from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";
import {
  StoredObjectDeliveryPort,
  StoredObjectStoragePort,
  StoredObjectUploadTokenPort,
  type StoredObjectStorageAddress,
  type StoredObjectUploadTokenClaims,
  StoredObjectService,
} from "../index";
import { InMemoryStoredObjectStore } from "../testing";

const sha256 = "a".repeat(64);
const address: StoredObjectStorageAddress = {
  provider: "existing-storage",
  destinationId: "primary",
  relativeId: "project_1/so_aaaaaaaa",
};

class MemoryStorage extends StoredObjectStoragePort {
  bytes = new Uint8Array([1, 2, 3]);
  deleted = false;
  deleteFailuresRemaining = 0;

  async write() {
    return address;
  }

  async tryCreateUpload(): Promise<{
    address: StoredObjectStorageAddress;
    target: StoredObjectDirectUploadTarget;
  }> {
    return {
      address,
      target: {
        method: "PUT",
        url: "https://storage.example/upload",
        headers: {},
        expiresAt: "2026-08-22T00:05:00.000Z",
      },
    };
  }

  async tryStat() {
    return { byteLength: 3, sha256 };
  }

  async tryRead() {
    const bytes = this.bytes;
    return (async function* () {
      yield bytes;
    })();
  }

  async delete() {
    if (this.deleteFailuresRemaining > 0) {
      this.deleteFailuresRemaining -= 1;
      throw new Error("provider unavailable");
    }
    this.deleted = true;
  }
}

class MemoryTokens extends StoredObjectUploadTokenPort {
  claims: StoredObjectUploadTokenClaims | null = null;

  async encode(claims: StoredObjectUploadTokenClaims) {
    this.claims = claims;
    return "token";
  }

  async decode() {
    if (!this.claims) throw new Error("missing token");
    return this.claims;
  }
}

class FixedDelivery extends StoredObjectDeliveryPort {
  async mint(): Promise<StoredObjectDeliveryCapability> {
    return {
      url: "https://files.example/object",
      expiresAt: "2026-08-22T00:05:00.000Z",
      methods: ["GET", "HEAD"],
      audience: "project:view",
      generation: 1,
    };
  }
}

function fixture() {
  const store = InMemoryStoredObjectStore.create();
  const storage = new MemoryStorage();
  const tokens = new MemoryTokens();
  const service = StoredObjectService.create({
    store,
    storage,
    uploadTokens: tokens,
    delivery: new FixedDelivery(),
    idDeriver: {
      fromDigest: ({ sha256: digest }) => `so_${digest.slice(0, 8)}`,
    },
    maximumUploadBytes: 1024,
    uploadExpiryMs: 300_000,
    now: () => new Date("2026-08-22T00:00:00.000Z"),
    operationId: () => "upload_1",
  });
  return { service, storage, store };
}

describe("StoredObjectService", () => {
  it("stores internal bytes once in the single row store", async () => {
    const { service, store } = fixture();
    const input = {
      projectId: "project_1",
      filename: "input.bin",
      mediaType: "application/octet-stream",
      audience: "project:view" as const,
      purpose: "test",
      ownerKind: "test",
      ownerId: "test_1",
      bytes: new Uint8Array([1, 2, 3]),
    };

    const first = await service.storeFromBytes(input);
    const second = await service.storeFromBytes(input);

    expect(first.isDuplicate).toBe(false);
    expect(second.isDuplicate).toBe(true);
    await expect(
      store.tryFind({ tenantId: "project_1", id: first.reference.id }),
    ).resolves.toMatchObject({ status: "available", generation: 1 });
  });

  it("persists a pending upload and confirms it in the same row", async () => {
    const { service, store } = fixture();
    const created = await service.createUpload({
      projectId: "project_1",
      filename: "input.bin",
      mediaType: "application/octet-stream",
      byteLength: 3,
      sha256,
    });
    expect(created.status).toBe("pending");
    await expect(
      store.tryFind({ tenantId: "project_1", id: "so_aaaaaaaa" }),
    ).resolves.toMatchObject({
      status: "pending",
      expiresAt: expect.any(Date),
    });

    const confirmed = await service.confirmUpload({
      projectId: "project_1",
      uploadToken: "token",
    });
    expect(confirmed.id).toBe("so_aaaaaaaa");
    await expect(
      store.tryFind({ tenantId: "project_1", id: "so_aaaaaaaa" }),
    ).resolves.toMatchObject({ status: "available", generation: 1 });
  });

  it("denies delivery from the row before deleting provider bytes", async () => {
    const { service, storage } = fixture();
    const stored = await service.storeFromBytes({
      projectId: "project_1",
      filename: "input.bin",
      mediaType: "application/octet-stream",
      audience: "project:view",
      purpose: "test",
      ownerKind: "test",
      ownerId: "test_1",
      bytes: new Uint8Array([1, 2, 3]),
    });

    await service.delete({
      projectId: "project_1",
      id: stored.reference.id,
      idempotencyKey: "delete_1",
    });

    expect(storage.deleted).toBe(true);
    await expect(
      service.getMetadata({ projectId: "project_1", id: stored.reference.id }),
    ).rejects.toMatchObject({ code: "stored_object_deleted" });
  });

  it("retries failed physical deletion from the same deleted row", async () => {
    const { service, storage, store } = fixture();
    const stored = await service.storeFromBytes({
      projectId: "project_1",
      filename: "input.bin",
      mediaType: "application/octet-stream",
      audience: "project:view",
      purpose: "test",
      ownerKind: "test",
      ownerId: "test_1",
      bytes: new Uint8Array([1, 2, 3]),
    });
    storage.deleteFailuresRemaining = 2;

    await service.delete({
      projectId: "project_1",
      id: stored.reference.id,
      idempotencyKey: "delete_retry_1",
    });

    await expect(service.cleanupDeletedObjects({ projectId: "project_1" })).resolves.toBe(0);
    await expect(service.cleanupDeletedObjects({ projectId: "project_1" })).resolves.toBe(1);
    await expect(
      store.tryFind({ tenantId: "project_1", id: stored.reference.id }),
    ).resolves.toMatchObject({ status: "deleted", storage: null });
  });
});

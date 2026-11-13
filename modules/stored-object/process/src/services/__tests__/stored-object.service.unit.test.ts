/** @vitest-environment node */
import { Readable } from "node:stream";

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  FixedStoredObjectDelivery,
  GrantedStoredObjectPermissions,
  MemoryStoredObjectFiles,
  MemoryStoredObjectStorage,
  createStoredObjectTestSigner,
} from "../../app/__tests__/stored-object.fixture.ts";
import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import { StoredObjectService } from "../stored-object.service.ts";

/** A socket pool of `size`: a read waits for a free socket, which only a closed body returns. */
class PooledStoredObjectStorage extends MemoryStoredObjectStorage {
  private free: number;
  private readonly waiting: (() => void)[] = [];

  constructor(size: number) {
    super();
    this.free = size;
  }

  override async getBytes() {
    if (this.free === 0) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.free -= 1;
    const body = new Readable({ read() {} });
    body.push(this.bytes);
    body.once("close", () => {
      const next = this.waiting.shift();
      if (next) next();
      else this.free += 1;
    });
    return body;
  }
}

function fixture({ storage = new MemoryStoredObjectStorage() } = {}) {
  const records = MemoryStoredObjectRecordRepository.create();
  const service = StoredObjectService.create({
    records,
    permissions: new GrantedStoredObjectPermissions(),
    storage,
    signer: createStoredObjectTestSigner(),
    legacy: new MemoryStoredObjectFiles(),
    delivery: new FixedStoredObjectDelivery(),
    maximumUploadBytes: 1024,
    uploadExpiryMs: 300_000,
    now: () => Temporal.Instant.from("2026-08-22T00:00:00.000Z"),
    newId: () => "so_aaaaaaaa",
  });

  return { service, storage, records };
}

describe("StoredObjectService", () => {
  it("persists a pending upload and confirms it in the same row", async () => {
    const { service, records } = fixture();
    const created = await service.createUpload({
      projectId: "project_1",
      filename: "input.bin",
      mediaType: "application/octet-stream",
      byteLength: 3,
      purpose: "dataset_attachment",
    });
    expect(created).toMatchObject({ objectId: "so_aaaaaaaa", method: "PUT" });
    await expect(
      records.findById({ tenantId: "project_1", id: "so_aaaaaaaa" }),
    ).resolves.toMatchObject({
      status: "pending",
      expiresAt: Temporal.Instant.from("2026-08-22T00:05:00.000Z"),
    });

    const confirmed = await service.confirmUpload({
      projectId: "project_1",
      objectId: created.objectId,
    });
    expect(confirmed.id).toBe("so_aaaaaaaa");
    await expect(
      records.findById({ tenantId: "project_1", id: "so_aaaaaaaa" }),
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

  it("hands each probed body's socket back, so reads past the pool size do not hang", async () => {
    const { service } = fixture({ storage: new PooledStoredObjectStorage(50) });
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

    const urls: string[] = [];
    for (let call = 0; call < 60; call += 1) {
      const { url } = await service.getReadUrl(
        { projectId: "project_1", storedObjectId: stored.reference.id },
        { id: "user_1" },
      );
      urls.push(url);
    }

    expect(urls).toHaveLength(60);
  }, 5_000);

  it("retries failed physical deletion from the same deleted row", async () => {
    const { service, storage, records } = fixture();
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
      records.findById({ tenantId: "project_1", id: stored.reference.id }),
    ).resolves.toMatchObject({ status: "deleted", storage: null });
  });
});

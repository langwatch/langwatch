/** @vitest-environment node */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";
import {
  FixedStoredObjectDelivery,
  MemoryStoredObjectStorage,
  MemoryStoredObjectTokens,
  STORED_OBJECT_TEST_SHA256 as sha256,
} from "../../app/__tests__/stored-object.fixture.ts";
import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import { StoredObjectService } from "../stored-object.service.ts";

function fixture() {
  const records = MemoryStoredObjectRecordRepository.create();
  const storage = new MemoryStoredObjectStorage();
  const service = StoredObjectService.create({
    records,
    storage,
    uploadTokens: new MemoryStoredObjectTokens(),
    delivery: new FixedStoredObjectDelivery(),
    idDeriver: {
      fromDigest: ({ sha256: digest }) => `so_${digest.slice(0, 8)}`,
    },
    maximumUploadBytes: 1024,
    uploadExpiryMs: 300_000,
    now: () => Temporal.Instant.from("2026-08-22T00:00:00.000Z"),
    operationId: () => "upload_1",
  });

  return { service, storage, records };
}

describe("StoredObjectService", () => {
  it("stores internal bytes once in the single row store", async () => {
    const { service, records } = fixture();
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
      records.findById({ tenantId: "project_1", id: first.reference.id }),
    ).resolves.toMatchObject({ status: "available", generation: 1 });
  });

  it("persists a pending upload and confirms it in the same row", async () => {
    const { service, records } = fixture();
    const created = await service.createUpload({
      projectId: "project_1",
      filename: "input.bin",
      mediaType: "application/octet-stream",
      byteLength: 3,
      sha256,
    });
    expect(created.status).toBe("pending");
    await expect(
      records.findById({ tenantId: "project_1", id: "so_aaaaaaaa" }),
    ).resolves.toMatchObject({
      status: "pending",
      expiresAt: Temporal.Instant.from("2026-08-22T00:05:00.000Z"),
    });

    const confirmed = await service.confirmUpload({
      projectId: "project_1",
      uploadToken: "token",
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

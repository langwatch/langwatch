/** @vitest-environment node */
import { Readable } from "node:stream";

import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  FixedStoredObjectDelivery,
  GrantedStoredObjectPermissions,
  MemoryStoredObjectFiles,
  MemoryStoredObjectStorage,
  createStoredObjectTestSigner,
} from "../../app/__tests__/stored-object.fixture.ts";
import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import { StoredObjectService } from "../stored-object.service.ts";

function fixture() {
  const records = MemoryStoredObjectRecordRepository.create();
  const storage = new MemoryStoredObjectStorage();
  const legacy = new MemoryStoredObjectFiles();
  const service = StoredObjectService.create({
    records,
    permissions: new GrantedStoredObjectPermissions(),
    storage,
    signer: createStoredObjectTestSigner(),
    legacy,
    delivery: new FixedStoredObjectDelivery(),
    maximumUploadBytes: 1024,
    uploadExpiryMs: 300_000,
    now: () => Temporal.Instant.from("2026-08-22T00:00:00.000Z"),
    newId: () => "so_aaaaaaaa",
  });

  return { service, storage, records, legacy };
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

  describe("when another writer moves the row on before every delete write", () => {
    /** @scenario "A delete that keeps losing its row write reports a write conflict" */
    it("refuses with a retryable write conflict and leaves the row and its bytes", async () => {
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
      const query = { tenantId: "project_1", id: stored.reference.id };
      const transition = records.transition.bind(records);
      let competingWrites = 0;
      vi.spyOn(records, "transition").mockImplementation(async (input) => {
        const current = await records.findById(query);
        if (!current) throw new Error("the row vanished");
        await transition({
          expected: current,
          next: { ...current, generation: current.generation + 1 },
        });
        competingWrites += 1;
        return transition(input);
      });

      await expect(
        service.delete({ projectId: "project_1", id: stored.reference.id, idempotencyKey: "d_1" }),
      ).rejects.toMatchObject({
        code: "stored_object_write_conflict",
        httpStatus: 409,
        retryable: true,
      });

      expect(competingWrites).toBeGreaterThan(1);
      expect(storage.deleted).toBe(false);
      await expect(records.findById(query)).resolves.toMatchObject({ status: "available" });
    });
  });

  describe("when a viewer probes an object or asks for its read URL", () => {
    async function storedAttachment() {
      const built = fixture();
      const stored = await built.service.storeFromBytes({
        projectId: "project_1",
        filename: "input.bin",
        mediaType: "application/octet-stream",
        audience: "project:view",
        purpose: "dataset_attachment",
        ownerKind: "dataset",
        ownerId: "dataset_1",
        bytes: new Uint8Array([1, 2, 3]),
      });
      return { ...built, object: { projectId: "project_1", id: stored.reference.id } };
    }

    /** @scenario "Probing an object or minting its read URL opens none of its bytes" */
    it("answers available from an existence check and opens no bytes", async () => {
      const { service, storage, object } = await storedAttachment();

      await expect(service.headById(object, { id: "user_1" })).resolves.toEqual({
        status: "available",
        mediaType: "application/octet-stream",
      });
      expect(storage.opened).toBe(0);
    });

    /** @scenario "Probing an object or minting its read URL opens none of its bytes" */
    it("answers missing when storage no longer holds the bytes, opening none", async () => {
      const { service, storage, object } = await storedAttachment();
      storage.held = false;

      await expect(service.headById(object, { id: "user_1" })).resolves.toEqual({
        status: "missing",
        mediaType: "application/octet-stream",
      });
      expect(storage.opened).toBe(0);
    });

    /** @scenario "Probing an object or minting its read URL opens none of its bytes" */
    it("signs a read URL for the purpose without opening the bytes", async () => {
      const { service, storage, object } = await storedAttachment();

      await expect(
        service.getReadUrlForPurpose({
          ...object,
          purpose: "dataset_attachment",
          ownerKind: "dataset",
        }),
      ).resolves.toMatchObject({ url: expect.any(String) });
      expect(storage.opened).toBe(0);
    });
  });

  describe("when a peer asks for a read URL of an object only the legacy index holds", () => {
    /** @scenario "Probing an object or minting its read URL opens none of its bytes" */
    it("signs the URL from the index row without opening the object's bytes", async () => {
      const { service, legacy } = fixture();
      const body = Readable.from([Buffer.from([1, 2, 3])]);
      legacy.read = {
        row: {
          id: "so_legacy",
          purpose: "trace_content",
          owner_kind: "trace",
          media_type: "audio/mpeg",
          size_bytes: 3,
        },
        stream: body,
      };

      await expect(
        service.getReadUrlForPurpose({
          projectId: "project_1",
          id: "so_legacy",
          purpose: "trace_content",
          ownerKind: "trace",
        }),
      ).resolves.toMatchObject({ url: expect.any(String) });
      expect(legacy.opened).toBe(0);
      expect(body.destroyed).toBe(false);
    });
  });

  describe("when a reader reads an object whose bytes storage streams", () => {
    /** @scenario "A byte read hands over storage's own stream" */
    it("hands over that same stream, so stopping it early reaches the storage connection", async () => {
      const { service, storage } = fixture();
      const stored = await service.storeFromBytes({
        projectId: "project_1",
        filename: "input.bin",
        mediaType: "application/octet-stream",
        audience: "project:view",
        purpose: "dataset_attachment",
        ownerKind: "dataset",
        ownerId: "dataset_1",
        bytes: new Uint8Array([1, 2, 3]),
      });
      const body = Readable.from([Buffer.from([1, 2, 3])]);
      storage.stream = body;

      const read = await service.readById({ projectId: "project_1", id: stored.reference.id });

      expect("stream" in read && read.stream).toBe(body);
    });
  });
});

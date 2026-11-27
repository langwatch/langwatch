/**
 * @vitest-environment node
 * The reaper's fairness: rows whose bytes keep refusing deletion never stop it
 * reaching the rows and projects behind them.
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
import { memoryObjectStorage, type ObjectStorage } from "@langwatch/process-stores";
import type { StoredObjectId, StoredObjectProjectId } from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import { ObjectStorageStoredObjectBytesRepository } from "../../repositories/object-storage/object-storage.stored-object-bytes.repository.ts";
import type { StoredObjectRecord } from "../../repositories/stored-object-record.repository.ts";
import { StoredObjectUploadReapService } from "../stored-object-upload-reap.service.ts";

const FILE = new TextEncoder().encode("abandoned bytes");

function fixture({ batchSize }: { batchSize: number }) {
  let now: Instant = Temporal.Instant.from("2026-11-17T09:00:00.000Z");
  const inner = memoryObjectStorage();
  /** Keys whose delete the bucket refuses every time. */
  const undeletable = new Set<string>();
  const objectStorage: ObjectStorage = {
    ...inner,
    remove: async (at) => {
      if (undeletable.has(at.key)) throw new Error("403 AccessDenied");
      return inner.remove(at);
    },
  };
  const records = MemoryStoredObjectRecordRepository.create();
  const storage = ObjectStorageStoredObjectBytesRepository.create({ objectStorage });
  const reaper = StoredObjectUploadReapService.create({
    records,
    storage,
    batchSize,
    now: () => now,
  });

  const expiredUpload = async ({
    projectId,
    objectId,
    deletable,
  }: {
    projectId: string;
    objectId: string;
    deletable: boolean;
  }): Promise<StoredObjectRecord> => {
    const { address } = await storage.place({ projectId, objectId });
    await storage.write({
      projectId,
      address,
      body: (async function* () {
        yield FILE;
      })(),
      byteLength: FILE.byteLength,
      mediaType: "text/plain",
    });
    if (!deletable) undeletable.add(address.relativeId);
    const expiresAt = now.subtract({ hours: 1 });
    const record: StoredObjectRecord = {
      tenantId: projectId as StoredObjectProjectId,
      id: objectId as StoredObjectId,
      status: "pending",
      purpose: "dataset_attachment",
      ownerKind: "project",
      ownerId: projectId,
      filename: "notes.txt",
      sha256: "",
      byteLength: FILE.byteLength,
      mediaType: "text/plain",
      mediaTypeVerified: false,
      storage: address,
      generation: 0,
      audiences: ["datasets:view"],
      expiresAt,
      availableAt: null,
      deletedAt: null,
      source: "canonical",
      legacyFingerprint: null,
      createdAt: expiresAt,
      updatedAt: expiresAt,
    };
    await records.upsert(record);

    return record;
  };
  const isHeld = (value: StoredObjectRecord) =>
    storage.exists({ projectId: value.tenantId, address: value.storage! });
  const later = (minutes: number) => {
    now = now.add({ minutes });
  };

  return { reaper, expiredUpload, isHeld, later };
}

describe("StoredObjectUploadReapService", () => {
  describe("given a project whose first page of expired uploads all refuse deletion", () => {
    describe("when the reaper wakes", () => {
      /** @scenario "Expired pending uploads are reaped on a schedule" */
      it("pages past them in the same pass and reaps the upload behind them", async () => {
        const { reaper, expiredUpload, isHeld } = fixture({ batchSize: 2 });
        await expiredUpload({ projectId: "project_a", objectId: "so_1", deletable: false });
        await expiredUpload({ projectId: "project_a", objectId: "so_2", deletable: false });
        const behind = await expiredUpload({
          projectId: "project_a",
          objectId: "so_3",
          deletable: true,
        });

        await expect(reaper.reap()).resolves.toBe(1);
        await expect(isHeld(behind)).resolves.toBe(false);
      });
    });
  });

  describe("given more projects with undeletable uploads than one pass reaches", () => {
    describe("when the reaper wakes again", () => {
      /** @scenario "Expired pending uploads are reaped on a schedule" */
      it("reaches the project behind them instead of retrying the same ones", async () => {
        const { reaper, expiredUpload, isHeld, later } = fixture({ batchSize: 1 });
        for (let index = 0; index < 10; index += 1) {
          await expiredUpload({
            projectId: `project_${index.toString().padStart(2, "0")}`,
            objectId: `so_${index}`,
            deletable: false,
          });
        }
        const behind = await expiredUpload({
          projectId: "project_99",
          objectId: "so_99",
          deletable: true,
        });

        await expect(reaper.reap()).resolves.toBe(0);
        later(15);

        await expect(reaper.reap()).resolves.toBe(1);
        await expect(isHeld(behind)).resolves.toBe(false);
      });
    });
  });
});

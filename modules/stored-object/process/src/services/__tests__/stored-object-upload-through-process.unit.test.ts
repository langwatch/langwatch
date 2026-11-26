import { createHash } from "node:crypto";

/**
 * @vitest-environment node
 * Bytes sent to LangWatch's signed route: the digest the write took is kept, so a
 * confirm reads nothing back, and a client that breaks off is told so.
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
import { memoryObjectStorage, type ObjectStorage } from "@langwatch/process-stores";
import type { StoredObjectUploadBody } from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  FixedStoredObjectDelivery,
  GrantedStoredObjectPermissions,
  MemoryStoredObjectFiles,
  createStoredObjectTestSigner,
} from "../../app/__tests__/stored-object.fixture.ts";
import { MemoryStoredObjectOwnerLinkRepository } from "../../repositories/memory/memory.stored-object-owner-link.repository.ts";
import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import { ObjectStorageStoredObjectBytesRepository } from "../../repositories/object-storage/object-storage.stored-object-bytes.repository.ts";
import { StoredObjectService } from "../stored-object.service.ts";

const PROJECT_ID = "project_1";
const FILE = new TextEncoder().encode("a file sent through LangWatch");

/** A request body whose connection breaks after the chunks it was given. */
class BreakingBody implements StoredObjectUploadBody {
  constructor(private readonly chunks: readonly Uint8Array[]) {}

  getReader() {
    const pending = [...this.chunks];

    return {
      read: async () => {
        const value = pending.shift();
        if (value === undefined) throw new Error("socket hang up");
        return { done: false as const, value };
      },
      releaseLock: () => undefined,
    };
  }
}

function fixture() {
  let now: Instant = Temporal.Instant.from("2026-11-17T09:00:00.000Z");
  const inner = memoryObjectStorage();
  const readBacks: string[] = [];
  const failures = { storageRefusesWrites: false };
  const objectStorage: ObjectStorage = {
    ...inner,
    write: async (at, body, facts) => {
      if (!failures.storageRefusesWrites) return inner.write(at, body, facts);
      for await (const _chunk of body) void _chunk;
      throw new Error("503 Slow Down");
    },
    digest: (at) => {
      readBacks.push(`digest:${at.key}`);
      return inner.digest(at);
    },
    read: (at) => {
      readBacks.push(`read:${at.key}`);
      return inner.read(at);
    },
  };
  const storage = ObjectStorageStoredObjectBytesRepository.create({ objectStorage });
  const records = MemoryStoredObjectRecordRepository.create();
  const service = StoredObjectService.create({
    records,
    ownerLinks: MemoryStoredObjectOwnerLinkRepository.create(),
    permissions: new GrantedStoredObjectPermissions(),
    storage,
    signer: createStoredObjectTestSigner(),
    legacy: new MemoryStoredObjectFiles(),
    delivery: new FixedStoredObjectDelivery(),
    maximumUploadBytes: 1024 * 1024,
    uploadExpiryMs: 15 * 60 * 1000,
    now: () => now,
  });

  const create = async () => {
    const created = await service.createUpload({
      projectId: PROJECT_ID,
      purpose: "dataset_attachment",
      filename: "notes.txt",
      mediaType: "text/plain",
      byteLength: FILE.byteLength,
    });

    return {
      objectId: created.objectId,
      signature: new URL(created.uploadUrl).searchParams.get("sig") ?? "",
    };
  };

  const later = (minutes: number) => {
    now = now.add({ minutes });
  };

  return { service, records, storage, readBacks, failures, create, later };
}

describe("StoredObjectService uploads through LangWatch's signed route", () => {
  describe("given a file written through the signed route before its upload expired", () => {
    describe("when the client confirms after the 15-minute upload window", () => {
      /** @scenario "A file that landed through LangWatch still confirms after the upload window" */
      it("makes the stored object available without reading it back", async () => {
        const { service, readBacks, create, later } = fixture();
        const upload = await create();
        later(14);
        await service.writeUpload({
          ...upload,
          contentLength: FILE.byteLength,
          body: new Blob([FILE]).stream(),
        });
        later(16);

        const confirmed = await service.confirmUpload({
          projectId: PROJECT_ID,
          objectId: upload.objectId,
        });

        expect(confirmed).toMatchObject({
          id: upload.objectId,
          byteLength: FILE.byteLength,
          sha256: createHash("sha256").update(FILE).digest("hex"),
        });
        await expect(
          service.getMetadata({ projectId: PROJECT_ID, id: upload.objectId }),
        ).resolves.toMatchObject({ status: "available" });
        expect(readBacks).toEqual([]);
      });
    });
  });

  describe("given a direct upload whose bytes LangWatch never saw", () => {
    describe("when the client confirms after the upload window", () => {
      it("refuses it as expired", async () => {
        const { service, create, later } = fixture();
        const upload = await create();
        later(16);

        await expect(
          service.confirmUpload({ projectId: PROJECT_ID, objectId: upload.objectId }),
        ).rejects.toMatchObject({ code: "upload_expired" });
      });
    });
  });

  describe("given a client sending a file to the signed route", () => {
    describe("when the client's connection breaks before the whole file arrived", () => {
      /** @scenario "A client that stops sending mid-upload gets an incomplete upload, not a platform fault" */
      it("refuses the upload as incomplete and keeps nothing in the bucket", async () => {
        const { service, records, storage, create } = fixture();
        const upload = await create();

        await expect(
          service.writeUpload({
            ...upload,
            contentLength: FILE.byteLength,
            body: new BreakingBody([FILE.subarray(0, 5)]),
          }),
        ).rejects.toMatchObject({ code: "upload_incomplete" });

        const row = await records.findById({ tenantId: PROJECT_ID, id: upload.objectId });
        expect(row?.storage).toBeTruthy();
        await expect(
          storage.exists({ projectId: PROJECT_ID, address: row!.storage! }),
        ).resolves.toBe(false);
      });
    });

    describe("when the body ends before the declared length", () => {
      /** @scenario "A client that stops sending mid-upload gets an incomplete upload, not a platform fault" */
      it("refuses the upload as incomplete", async () => {
        const { service, create } = fixture();
        const upload = await create();

        await expect(
          service.writeUpload({
            ...upload,
            contentLength: undefined,
            body: new Blob([FILE.subarray(0, 5)]).stream(),
          }),
        ).rejects.toMatchObject({ code: "upload_incomplete" });
      });
    });
  });

  describe("given the bucket refuses a write the client sent in full", () => {
    it("reports the storage as unavailable", async () => {
      const { service, failures, create } = fixture();
      const upload = await create();
      failures.storageRefusesWrites = true;

      await expect(
        service.writeUpload({
          ...upload,
          contentLength: FILE.byteLength,
          body: new Blob([FILE]).stream(),
        }),
      ).rejects.toMatchObject({ code: "storage_unavailable" });
    });
  });
});

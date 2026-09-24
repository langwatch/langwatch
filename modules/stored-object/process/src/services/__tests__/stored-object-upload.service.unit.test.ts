/**
 * @vitest-environment node
 * @see modules/stored-object/specs/purpose-scoped-upload.feature
 */
import { createHash } from "node:crypto";

import { memoryObjectStorage } from "@langwatch/process-stores";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  FixedStoredObjectDelivery,
  GrantedStoredObjectPermissions,
  MemoryStoredObjectFiles,
  createStoredObjectTestSigner,
} from "../../app/__tests__/stored-object.fixture.ts";
import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import { StoredObjectStorageService } from "../stored-object-storage.service.ts";
import { StoredObjectService } from "../stored-object.service.ts";

const MIB = 1024 * 1024;
const PROJECT_ID = "project_1";
const RECEIPT = new TextEncoder().encode("receipt bytes");

function fixture() {
  const records = MemoryStoredObjectRecordRepository.create();
  const service = StoredObjectService.create({
    records,
    permissions: new GrantedStoredObjectPermissions(),
    storage: StoredObjectStorageService.create({ objectStorage: memoryObjectStorage() }),
    signer: createStoredObjectTestSigner(),
    legacy: new MemoryStoredObjectFiles(),
    delivery: new FixedStoredObjectDelivery(),
    maximumUploadBytes: 100 * MIB,
    uploadExpiryMs: 15 * 60 * 1000,
    now: () => Temporal.Instant.from("2026-09-24T00:00:00.000Z"),
  });

  return { service, records };
}

function createAttachmentUpload(
  service: StoredObjectService,
  overrides: Partial<{ purpose: string; mediaType: string; byteLength: number }> = {},
) {
  return service.createUpload({
    projectId: PROJECT_ID,
    purpose: "dataset_attachment",
    filename: "receipt.png",
    mediaType: "image/png",
    byteLength: RECEIPT.byteLength,
    ...overrides,
  });
}

async function uploadAndConfirm(service: StoredObjectService, bytes: Uint8Array) {
  const created = await createAttachmentUpload(service, { byteLength: bytes.byteLength });
  await service.writeUpload({
    objectId: created.objectId,
    signature: new URL(created.uploadUrl).searchParams.get("sig") ?? "",
    contentLength: bytes.byteLength,
    body: new Blob([new Uint8Array(bytes)]).stream(),
  });

  return service.confirmUpload({ projectId: PROJECT_ID, objectId: created.objectId });
}

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("StoredObjectService uploads", () => {
  describe("given the same file uploaded and confirmed twice", () => {
    /** @scenario "Every stored file gets a new id of its own" */
    it("answers a new id for each, derived from none of the file's facts", async () => {
      const { service } = fixture();

      const first = await uploadAndConfirm(service, RECEIPT);
      const second = await uploadAndConfirm(service, RECEIPT);

      expect(second.id).not.toBe(first.id);
      for (const id of [first.id, second.id]) {
        expect(id).not.toContain(sha256Of(RECEIPT));
        expect(id).not.toContain(PROJECT_ID);
        expect(id).not.toContain("dataset_attachment");
      }
    });
  });

  describe("when the purpose is one only LangWatch writes", () => {
    /** @scenario "A purpose that only LangWatch itself writes cannot be uploaded" */
    it("refuses the purpose field", async () => {
      const { service } = fixture();

      await expect(
        createAttachmentUpload(service, { purpose: "trace_content" }),
      ).rejects.toMatchObject({
        code: "validation_error",
        meta: { fieldErrors: { purpose: [expect.any(String)] } },
      });
    });
  });

  describe("when a dataset attachment is declared over its size limit", () => {
    /** @scenario "A file over the purpose's size limit is refused before any transfer" */
    it("refuses it as too large and names the attachment limit", async () => {
      const { service } = fixture();

      await expect(createAttachmentUpload(service, { byteLength: 30 * MIB })).rejects.toMatchObject(
        { code: "upload_too_large", meta: { maximumUploadBytes: 20 * MIB } },
      );
    });
  });

  describe("when a dataset import is declared far larger than an attachment may be", () => {
    /** @scenario "A dataset import may be far larger than an attachment" */
    it("answers an address to put the file to", async () => {
      const { service } = fixture();

      const created = await createAttachmentUpload(service, {
        purpose: "dataset_import",
        mediaType: "text/csv",
        byteLength: 2 * 1024 * MIB,
      });

      expect(created.method).toBe("PUT");
      expect(created.uploadUrl).toContain(
        `/api/stored-objects/uploads/${created.objectId}/content`,
      );
    });
  });

  describe("when the file is of a kind a browser can run", () => {
    /** @scenario "A file a browser can run is refused for every purpose" */
    it.each([
      ["dataset_attachment", "text/html"],
      ["dataset_attachment", "image/svg+xml"],
      ["dataset_attachment", "application/javascript"],
      ["dataset_import", "text/html"],
      ["dataset_import", "image/svg+xml"],
      ["dataset_import", "application/javascript"],
    ])("refuses a %s of type %s on its media type", async (purpose, mediaType) => {
      const { service } = fixture();

      await expect(createAttachmentUpload(service, { purpose, mediaType })).rejects.toMatchObject({
        code: "validation_error",
        meta: { fieldErrors: { mediaType: [expect.any(String)] } },
      });
    });
  });

  describe("given a confirmed upload", () => {
    /** @scenario "Confirming twice answers the same reference" */
    it("answers the same reference when confirmed again", async () => {
      const { service } = fixture();
      const first = await uploadAndConfirm(service, RECEIPT);

      const again = await service.confirmUpload({ projectId: PROJECT_ID, objectId: first.id });

      expect(again).toEqual(first);
    });
  });

  describe("when LangWatch stores the same bytes from two traces", () => {
    /** @scenario "A file LangWatch stores itself gets a new id and is hashed as it streams" */
    it("stores each as its own file with the digest the storage write computed", async () => {
      const { service, records } = fixture();
      const input = {
        projectId: PROJECT_ID,
        filename: "picture.png",
        mediaType: "image/png",
        audience: "project:view",
        purpose: "trace_content",
        ownerKind: "trace",
        ownerId: "trace_1",
        bytes: RECEIPT,
      } as const;

      const first = await service.storeFromBytes(input);
      const second = await service.storeFromBytes({ ...input, ownerId: "trace_2" });

      expect(second.reference.id).not.toBe(first.reference.id);
      for (const stored of [first, second]) {
        await expect(
          records.findById({ tenantId: PROJECT_ID, id: stored.reference.id }),
        ).resolves.toMatchObject({ status: "available", sha256: sha256Of(RECEIPT) });
      }
    });
  });
});

/**
 * @vitest-environment node
 * The one place the process accepts upload bytes: the seal, the object it
 * names and its expiry are checked before a single body byte is read.
 * @see modules/stored-object/specs/purpose-scoped-upload.feature
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
import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import { StoredObjectStorageService } from "../stored-object-storage.service.ts";
import { StoredObjectService } from "../stored-object.service.ts";

const PROJECT_ID = "project_1";
const DECLARED = new TextEncoder().encode("receipt bytes");

/** A request body that counts every read the service asks of it. */
class CountingBody implements StoredObjectUploadBody {
  reads = 0;

  constructor(private readonly chunks: readonly Uint8Array[]) {}

  getReader() {
    const pending = [...this.chunks];

    return {
      read: async () => {
        this.reads += 1;
        const value = pending.shift();
        return value === undefined ? { done: true as const } : { done: false as const, value };
      },
      releaseLock: () => undefined,
    };
  }
}

function fixture() {
  let now: Instant = Temporal.Instant.from("2026-09-24T00:00:00.000Z");
  const inner = memoryObjectStorage();
  const writes: string[] = [];
  const objectStorage: ObjectStorage = {
    ...inner,
    write: (at, body, facts) => {
      writes.push(at.key);
      return inner.write(at, body, facts);
    },
  };
  const service = StoredObjectService.create({
    records: MemoryStoredObjectRecordRepository.create(),
    permissions: new GrantedStoredObjectPermissions(),
    storage: StoredObjectStorageService.create({ objectStorage }),
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
      filename: "receipt.png",
      mediaType: "image/png",
      byteLength: DECLARED.byteLength,
    });

    return {
      objectId: created.objectId,
      signature: new URL(created.uploadUrl).searchParams.get("sig") ?? "",
    };
  };

  const later = (minutes: number) => {
    now = now.add({ minutes });
  };

  return { service, writes, create, later };
}

async function refusalOf(write: Promise<void>): Promise<unknown> {
  return write.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("StoredObjectService.writeUpload", () => {
  describe.each([
    {
      case: "missing",
      signatureOf: () => "",
      code: "upload_token_invalid",
    },
    {
      case: "altered",
      signatureOf: (signature: string) => signature.slice(0, -2),
      code: "upload_token_invalid",
    },
  ])("given a $case signature", ({ signatureOf, code }) => {
    /** @scenario "A local upload with a missing, altered or expired signature is refused before the body is read" */
    it("refuses the upload without reading the body or writing anything", async () => {
      const { service, writes, create } = fixture();
      const upload = await create();
      const body = new CountingBody([DECLARED]);

      const refusal = await refusalOf(
        service.writeUpload({
          objectId: upload.objectId,
          signature: signatureOf(upload.signature),
          contentLength: DECLARED.byteLength,
          body,
        }),
      );

      expect(refusal).toMatchObject({ code });
      expect(body.reads).toBe(0);
      expect(writes).toEqual([]);
    });
  });

  describe("given a signature sealed for another object", () => {
    /** @scenario "A local upload with a missing, altered or expired signature is refused before the body is read" */
    it("refuses the upload without reading the body or writing anything", async () => {
      const { service, writes, create } = fixture();
      const first = await create();
      const second = await create();
      const body = new CountingBody([DECLARED]);

      const refusal = await refusalOf(
        service.writeUpload({
          objectId: second.objectId,
          signature: first.signature,
          contentLength: DECLARED.byteLength,
          body,
        }),
      );

      expect(refusal).toMatchObject({ code: "upload_token_invalid" });
      expect(body.reads).toBe(0);
      expect(writes).toEqual([]);
    });
  });

  describe("given a signature past its expiry", () => {
    /** @scenario "A local upload with a missing, altered or expired signature is refused before the body is read" */
    it("refuses the upload without reading the body or writing anything", async () => {
      const { service, writes, create, later } = fixture();
      const upload = await create();
      later(16);
      const body = new CountingBody([DECLARED]);

      const refusal = await refusalOf(
        service.writeUpload({ ...upload, contentLength: DECLARED.byteLength, body }),
      );

      expect(refusal).toMatchObject({ code: "upload_expired" });
      expect(body.reads).toBe(0);
      expect(writes).toEqual([]);
    });
  });

  describe("given a request declaring more bytes than were sealed", () => {
    /** @scenario "A local upload longer than declared is cut off and discarded" */
    it("refuses it as too large before reading the body", async () => {
      const { service, writes, create } = fixture();
      const upload = await create();
      const body = new CountingBody([DECLARED, DECLARED]);

      const refusal = await refusalOf(
        service.writeUpload({ ...upload, contentLength: DECLARED.byteLength * 2, body }),
      );

      expect(refusal).toMatchObject({ code: "upload_too_large" });
      expect(body.reads).toBe(0);
      expect(writes).toEqual([]);
    });
  });

  describe("given a body that runs past the sealed length without declaring it", () => {
    /** @scenario "A local upload longer than declared is cut off and discarded" */
    it("cuts it off as too large and leaves nothing to confirm", async () => {
      const { service, create } = fixture();
      const upload = await create();

      const refusal = await refusalOf(
        service.writeUpload({
          ...upload,
          contentLength: undefined,
          body: new CountingBody([DECLARED, DECLARED]),
        }),
      );

      expect(refusal).toMatchObject({ code: "upload_too_large" });
      await expect(
        service.confirmUpload({ projectId: PROJECT_ID, objectId: upload.objectId }),
      ).rejects.toMatchObject({ code: "upload_incomplete" });
    });
  });

  describe("given a sealed upload of the declared length", () => {
    it("writes the body and confirms it", async () => {
      const { service, writes, create } = fixture();
      const upload = await create();

      await service.writeUpload({
        ...upload,
        contentLength: DECLARED.byteLength,
        body: new CountingBody([DECLARED]),
      });

      expect(writes).toHaveLength(1);
      await expect(
        service.confirmUpload({ projectId: PROJECT_ID, objectId: upload.objectId }),
      ).resolves.toMatchObject({ id: upload.objectId });
    });
  });
});

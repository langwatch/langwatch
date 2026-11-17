/**
 * @vitest-environment node
 * Upload lifecycle writes that race: a confirm against a write still in flight,
 * a confirm against the reaper, and a failed write against its own expiry.
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
import { createHash } from "node:crypto";

import { memoryObjectStorage, type ObjectStorage } from "@langwatch/process-stores";
import type { StoredObjectUploadBody } from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import {
  FixedStoredObjectDelivery,
  GrantedStoredObjectPermissions,
  MemoryStoredObjectFiles,
  createStoredObjectTestSigner,
} from "../../app/__tests__/stored-object.fixture.ts";
import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import { ObjectStorageStoredObjectBytesRepository } from "../../repositories/object-storage/object-storage.stored-object-bytes.repository.ts";
import type { StoredObjectRecord } from "../../repositories/stored-object-record.repository.ts";
import { StoredObjectUploadReapService } from "../stored-object-upload-reap.service.ts";
import { StoredObjectService } from "../stored-object.service.ts";

const PROJECT_ID = "project_1";
const FILE = new TextEncoder().encode("a file whose upload races something");
const SHA256 = createHash("sha256").update(FILE).digest("hex");

/** A gate a test opens by hand. */
function gate() {
  let open = () => undefined as void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { opened, open };
}

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
  /** Holds a write once its bytes are visible, as S3 answers a PUT the SDK has not returned. */
  const inFlight = { hold: null as Promise<void> | null, landed: gate() };
  const deleteFailures = { remaining: 0 };
  const objectStorage: ObjectStorage = {
    ...inner,
    write: async (at, body, facts) => {
      const digest = await inner.write(at, body, facts);
      inFlight.landed.open();
      if (inFlight.hold) await inFlight.hold;
      return digest;
    },
    remove: async (at) => {
      if (deleteFailures.remaining > 0) {
        deleteFailures.remaining -= 1;
        throw new Error("503 Slow Down");
      }
      return inner.remove(at);
    },
  };
  const storage = ObjectStorageStoredObjectBytesRepository.create({ objectStorage });
  const records = MemoryStoredObjectRecordRepository.create();
  const clock = () => now;
  const service = StoredObjectService.create({
    records,
    permissions: new GrantedStoredObjectPermissions(),
    storage,
    signer: createStoredObjectTestSigner(),
    legacy: new MemoryStoredObjectFiles(),
    delivery: new FixedStoredObjectDelivery(),
    maximumUploadBytes: 1024 * 1024,
    uploadExpiryMs: 15 * 60 * 1000,
    now: clock,
  });
  const reaper = StoredObjectUploadReapService.create({ records, storage, now: clock });

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
  const send = (upload: { objectId: string; signature: string }) =>
    service.writeUpload({
      ...upload,
      contentLength: FILE.byteLength,
      body: new Blob([FILE]).stream(),
    });
  const confirm = (objectId: string) => service.confirmUpload({ projectId: PROJECT_ID, objectId });
  const row = async (objectId: string): Promise<StoredObjectRecord> => {
    const value = await records.findById({ tenantId: PROJECT_ID, id: objectId });
    if (!value) throw new Error(`no row for ${objectId}`);
    return value;
  };
  const bytesOf = async (value: StoredObjectRecord): Promise<string | null> => {
    if (!value.storage) return null;
    const address = value.storage;
    if (!(await storage.exists({ projectId: PROJECT_ID, address }))) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of await storage.getBytes({ projectId: PROJECT_ID, address })) {
      chunks.push(chunk);
    }
    return createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
  };
  const later = (minutes: number) => {
    now = now.add({ minutes });
  };

  const remove = (objectId: string) =>
    service.delete({ projectId: PROJECT_ID, id: objectId, idempotencyKey: `delete:${objectId}` });

  return {
    service,
    remove,
    records,
    reaper,
    inFlight,
    deleteFailures,
    create,
    send,
    confirm,
    row,
    bytesOf,
    later,
  };
}

/** Runs `before` the first time the service writes the row as available, by whichever write. */
function beforeWritingAvailable(
  records: MemoryStoredObjectRecordRepository,
  before: () => Promise<unknown>,
): void {
  let fired = false;
  const fire = async (value: StoredObjectRecord) => {
    if (fired || value.status !== "available") return;
    fired = true;
    await before();
  };
  const upsert = records.upsert.bind(records);
  vi.spyOn(records, "upsert").mockImplementation(async (value) => {
    await fire(value);
    return upsert(value);
  });
  const transition = records.transition.bind(records);
  vi.spyOn(records, "transition").mockImplementation(async (input) => {
    await fire(input.next);
    return transition(input);
  });
}

describe("upload lifecycle races", () => {
  describe("given a client is still sending a file to LangWatch's signed route", () => {
    describe("when the client confirms before the file has fully arrived", () => {
      /** @scenario "Confirming while the file is still arriving is refused, and loses nothing" */
      it("refuses the confirm, and the file confirms with its bytes once it arrives", async () => {
        const { inFlight, create, send, confirm, row, bytesOf } = fixture();
        const upload = await create();
        const release = gate();
        inFlight.hold = release.opened;

        const sending = send(upload);
        await inFlight.landed.opened;
        await expect(confirm(upload.objectId)).rejects.toMatchObject({
          code: "upload_incomplete",
        });
        release.open();
        await sending;

        await expect(confirm(upload.objectId)).resolves.toMatchObject({ sha256: SHA256 });
        const value = await row(upload.objectId);
        expect(value.status).toBe("available");
        await expect(bytesOf(value)).resolves.toBe(SHA256);
      });
    });
  });

  describe("given an upload whose bytes landed and whose window has passed", () => {
    describe("when the reaper claims it while a confirm is between its read and its write", () => {
      /** @scenario "A confirm and the reaper never both win" */
      it("refuses the confirm and leaves the row failed with its bytes deleted", async () => {
        const { records, reaper, create, send, confirm, row, bytesOf, later } = fixture();
        const upload = await create();
        await send(upload);
        const address = (await row(upload.objectId)).storage;
        later(16);
        beforeWritingAvailable(records, () => reaper.reap());

        await expect(confirm(upload.objectId)).rejects.toMatchObject({
          code: "upload_incomplete",
        });

        const value = await row(upload.objectId);
        expect(value).toMatchObject({ status: "failed", storage: null });
        await expect(bytesOf({ ...value, storage: address })).resolves.toBeNull();
      });
    });

    describe("when a confirm wins while the reaper is between its read and its claim", () => {
      /** @scenario "A confirm and the reaper never both win" */
      it("leaves the row available with its bytes", async () => {
        const { records, reaper, create, send, confirm, row, bytesOf, later } = fixture();
        const upload = await create();
        await send(upload);
        later(16);
        const findPage = records.findPage.bind(records);
        let confirmed: unknown;
        vi.spyOn(records, "findPage").mockImplementationOnce(async (query) => {
          const page = await findPage(query);
          confirmed = await confirm(upload.objectId);
          return page;
        });

        await expect(reaper.reap()).resolves.toBe(0);

        expect(confirmed).toMatchObject({ id: upload.objectId, sha256: SHA256 });
        const value = await row(upload.objectId);
        expect(value.status).toBe("available");
        await expect(bytesOf(value)).resolves.toBe(SHA256);
      });
    });
  });

  describe("given a delete racing the upload's other writes", () => {
    describe("when a confirm wins between the delete's read and its write", () => {
      /** @scenario "A confirm and the reaper never both win" */
      it("deletes the object after the confirm, moving its generation on past it", async () => {
        const { records, create, send, confirm, remove, row, bytesOf } = fixture();
        const upload = await create();
        await send(upload);
        const address = (await row(upload.objectId)).storage;
        const findById = records.findById.bind(records);
        let availableGeneration = Number.NaN;
        vi.spyOn(records, "findById").mockImplementationOnce(async (query) => {
          const stale = await findById(query);
          await confirm(upload.objectId);
          availableGeneration = (await row(upload.objectId)).generation;
          return stale;
        });

        const deleted = await remove(upload.objectId);

        const value = await row(upload.objectId);
        expect(value).toMatchObject({ status: "deleted", storage: null });
        expect(deleted.generation).toBe(value.generation);
        expect(value.generation).toBeGreaterThan(availableGeneration);
        await expect(bytesOf({ ...value, storage: address })).resolves.toBeNull();
      });
    });

    describe("when the delete lands while the file is still arriving", () => {
      /** @scenario "A confirm and the reaper never both win" */
      it("refuses the write and leaves no bytes behind", async () => {
        const { inFlight, create, send, confirm, remove, row, bytesOf } = fixture();
        const upload = await create();
        const address = (await row(upload.objectId)).storage;
        const release = gate();
        inFlight.hold = release.opened;

        const sending = send(upload);
        await inFlight.landed.opened;
        await remove(upload.objectId);
        release.open();

        await expect(sending).rejects.toMatchObject({ code: "stored_object_deleted" });
        await expect(confirm(upload.objectId)).rejects.toMatchObject({
          code: "stored_object_deleted",
        });
        const value = await row(upload.objectId);
        expect(value).toMatchObject({ status: "deleted", storage: null });
        await expect(bytesOf({ ...value, storage: address })).resolves.toBeNull();
      });
    });
  });

  describe("given a client whose connection breaks mid-upload", () => {
    describe("when the failed write is over", () => {
      /** @scenario "A client that stops sending mid-upload gets an incomplete upload, not a platform fault" */
      it("puts the row back to pending with its original expiry", async () => {
        const { service, create, row, later } = fixture();
        const upload = await create();
        const before = await row(upload.objectId);
        later(5);

        await expect(
          service.writeUpload({
            ...upload,
            contentLength: FILE.byteLength,
            body: new BreakingBody([FILE.subarray(0, 5)]),
          }),
        ).rejects.toMatchObject({ code: "upload_incomplete" });

        const after = await row(upload.objectId);
        expect(after.status).toBe("pending");
        expect(after.expiresAt?.equals(before.expiresAt!)).toBe(true);
      });
    });
  });

  describe("given an expired pending upload whose bytes will not delete on the first try", () => {
    describe("when the reaper wakes twice", () => {
      /** @scenario "Expired pending uploads are reaped on a schedule" */
      it("leaves it pending for the next wake, then reaps it", async () => {
        const { reaper, deleteFailures, create, send, row, bytesOf, later } = fixture();
        const upload = await create();
        await send(upload);
        const address = (await row(upload.objectId)).storage;
        later(60);
        deleteFailures.remaining = 1;

        await expect(reaper.reap()).resolves.toBe(0);
        const kept = await row(upload.objectId);
        expect(kept.status).toBe("pending");
        await expect(bytesOf(kept)).resolves.toBe(SHA256);

        await expect(reaper.reap()).resolves.toBe(1);
        const reaped = await row(upload.objectId);
        expect(reaped).toMatchObject({ status: "failed", storage: null });
        await expect(bytesOf({ ...reaped, storage: address })).resolves.toBeNull();
      });
    });
  });
});

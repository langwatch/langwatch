import { createHash } from "node:crypto";

/**
 * @vitest-environment node
 * Upload lifecycle writes that race: a confirm against a write still in flight,
 * a confirm against the reaper, and a failed write against its own expiry.
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
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
import { MemoryStoredObjectOwnerLinkRepository } from "../../repositories/memory/memory.stored-object-owner-link.repository.ts";
import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import { ObjectStorageStoredObjectBytesRepository } from "../../repositories/object-storage/object-storage.stored-object-bytes.repository.ts";
import type { StoredObjectRecord } from "../../repositories/stored-object-record.repository.ts";
import { StoredObjectUploadReapService } from "../stored-object-upload-reap.service.ts";
import { StoredObjectService } from "../stored-object.service.ts";

const PROJECT_ID = "project_1";
const FILE = new TextEncoder().encode("a file whose upload races something");
const SHA256 = createHash("sha256").update(FILE).digest("hex");
const PAST_LANDED_WINDOW_MINUTES = 24 * 60 + 1;

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
  const inFlight = {
    hold: null as Promise<void> | null,
    landed: gate(),
    /** Holds a write before any byte lands, as a PUT still streaming does. */
    holdBefore: null as Promise<void> | null,
    started: gate(),
  };
  const deleteFailures = { remaining: 0 };
  const objectStorage: ObjectStorage = {
    ...inner,
    write: async (at, body, facts) => {
      inFlight.started.open();
      if (inFlight.holdBefore) await inFlight.holdBefore;
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
    ownerLinks: MemoryStoredObjectOwnerLinkRepository.create(),
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
        later(PAST_LANDED_WINDOW_MINUTES);
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
        later(PAST_LANDED_WINDOW_MINUTES);
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
      it("keeps it failed with its address, then deletes the bytes once the retry delay ends", async () => {
        const { reaper, deleteFailures, create, send, confirm, row, bytesOf, later } = fixture();
        const upload = await create();
        await send(upload);
        later(PAST_LANDED_WINDOW_MINUTES);
        deleteFailures.remaining = 1;

        await expect(reaper.reap()).resolves.toBe(0);
        const kept = await row(upload.objectId);
        expect(kept.status).toBe("failed");
        await expect(bytesOf(kept)).resolves.toBe(SHA256);
        await expect(confirm(upload.objectId)).rejects.toMatchObject({
          code: "upload_incomplete",
        });
        later(15);
        await expect(reaper.reap()).resolves.toBe(0);
        later(60);

        await expect(reaper.reap()).resolves.toBe(1);
        const reaped = await row(upload.objectId);
        expect(reaped).toMatchObject({ status: "failed", storage: null });
        await expect(bytesOf(kept)).resolves.toBeNull();
      });
    });
  });

  describe("given a failed row whose bytes were never deleted, as a reaper crash leaves it", () => {
    describe("when the reaper wakes", () => {
      /** @scenario "Expired pending uploads are reaped on a schedule" */
      it("deletes the bytes and clears the address", async () => {
        const { records, reaper, create, send, row, bytesOf, later } = fixture();
        const upload = await create();
        await send(upload);
        const landed = await row(upload.objectId);
        await records.transition({
          expected: landed,
          next: { ...landed, status: "failed", generation: landed.generation + 1 },
        });
        later(PAST_LANDED_WINDOW_MINUTES);

        await expect(reaper.reap()).resolves.toBe(1);

        const reaped = await row(upload.objectId);
        expect(reaped).toMatchObject({ status: "failed", storage: null });
        await expect(bytesOf(landed)).resolves.toBeNull();
      });
    });
  });

  describe("given a file that landed through the signed route", () => {
    describe("when the client confirms two hours later, after a reaper pass", () => {
      /** @scenario "A file that landed through LangWatch still confirms after the upload window" */
      it("still confirms, its bytes intact", async () => {
        const { reaper, create, send, confirm, row, bytesOf, later } = fixture();
        const upload = await create();
        await send(upload);
        later(120);

        await expect(reaper.reap()).resolves.toBe(0);
        await expect(confirm(upload.objectId)).resolves.toMatchObject({ sha256: SHA256 });
        await expect(bytesOf(await row(upload.objectId))).resolves.toBe(SHA256);
      });
    });

    describe("when nobody confirms it within 24 hours", () => {
      /** @scenario "Expired pending uploads are reaped on a schedule" */
      it("is reaped, its bytes deleted", async () => {
        const { reaper, create, send, row, bytesOf, later } = fixture();
        const upload = await create();
        await send(upload);
        const landed = await row(upload.objectId);
        later(PAST_LANDED_WINDOW_MINUTES);

        await expect(reaper.reap()).resolves.toBe(1);
        await expect(row(upload.objectId)).resolves.toMatchObject({ status: "failed" });
        await expect(bytesOf(landed)).resolves.toBeNull();
      });
    });

    describe("when the client sends a second file to the same signed address", () => {
      /** @scenario "A file that landed through LangWatch still confirms after the upload window" */
      it("refuses it before touching the bytes, and confirms the first file's digest", async () => {
        const { service, create, send, confirm, row, bytesOf } = fixture();
        const upload = await create();
        await send(upload);
        const other = new TextEncoder().encode("another file, the same length!!!!!!");
        expect(other.byteLength).toBe(FILE.byteLength);

        await expect(
          service.writeUpload({
            ...upload,
            contentLength: other.byteLength,
            body: new BreakingBody([other.subarray(0, 4)]),
          }),
        ).rejects.toMatchObject({ code: "upload_token_invalid" });

        await expect(confirm(upload.objectId)).resolves.toMatchObject({ sha256: SHA256 });
        await expect(bytesOf(await row(upload.objectId))).resolves.toBe(SHA256);
      });
    });

    describe("when a first send broke off before anything landed", () => {
      it("accepts the retry", async () => {
        const { service, create, send, confirm } = fixture();
        const upload = await create();
        await expect(
          service.writeUpload({
            ...upload,
            contentLength: FILE.byteLength,
            body: new BreakingBody([FILE.subarray(0, 4)]),
          }),
        ).rejects.toMatchObject({ code: "upload_incomplete" });

        await send(upload);

        await expect(confirm(upload.objectId)).resolves.toMatchObject({ sha256: SHA256 });
      });
    });
  });

  describe("given a delete while the file is still arriving, and the writer's discard fails", () => {
    describe("when the deleted-bytes cleanup runs", () => {
      /** @scenario "A confirm and the reaper never both win" */
      it("never leaves bytes on a row with no address, and the cleanup removes them", async () => {
        const { service, inFlight, deleteFailures, create, send, remove, row, bytesOf } = fixture();
        const upload = await create();
        const address = (await row(upload.objectId)).storage;
        const release = gate();
        inFlight.hold = release.opened;

        const sending = send(upload);
        await inFlight.landed.opened;
        await remove(upload.objectId);
        deleteFailures.remaining = 1;
        release.open();
        await expect(sending).rejects.toMatchObject({ code: "stored_object_deleted" });

        const afterRace = await row(upload.objectId);
        expect(afterRace.status).toBe("deleted");
        await expect(bytesOf({ ...afterRace, storage: address })).resolves.toBe(SHA256);
        expect(afterRace.storage).toEqual(address);

        await expect(service.cleanupDeletedObjects({ projectId: PROJECT_ID })).resolves.toBe(1);
        const cleaned = await row(upload.objectId);
        expect(cleaned.storage).toBeNull();
        await expect(bytesOf({ ...cleaned, storage: address })).resolves.toBeNull();
      });
    });
  });

  describe("given a delete while a write is still streaming, then a deleted-bytes cleanup", () => {
    describe("when the bytes land after the cleanup deleted the address, and the writer's discard fails", () => {
      /** @scenario "A confirm and the reaper never both win" */
      it("keeps the address with a deadline, so a stale cleanup cannot clear it and the reaper retries", async () => {
        const {
          service,
          records,
          reaper,
          inFlight,
          deleteFailures,
          create,
          send,
          remove,
          row,
          bytesOf,
          later,
        } = fixture();
        const upload = await create();
        const address = (await row(upload.objectId)).storage;
        const release = gate();
        inFlight.holdBefore = release.opened;
        const sending = send(upload).catch((error: unknown) => error);
        await inFlight.started.opened;
        await remove(upload.objectId);
        const transition = records.transition.bind(records);
        let landedUnderCleanup = false;
        vi.spyOn(records, "transition").mockImplementation(async (input) => {
          const isCleanupClear = input.expected.status === "deleted" && input.next.storage === null;
          if (isCleanupClear && !landedUnderCleanup) {
            landedUnderCleanup = true;
            deleteFailures.remaining = 1;
            release.open();
            await sending;
          }
          return transition(input);
        });

        await service.cleanupDeletedObjects({ projectId: PROJECT_ID });

        expect(landedUnderCleanup).toBe(true);
        await expect(sending).resolves.toMatchObject({ code: "stored_object_deleted" });
        const kept = await row(upload.objectId);
        await expect(bytesOf({ ...kept, storage: address })).resolves.toBe(SHA256);
        expect(kept.storage).toEqual(address);
        expect(kept.expiresAt).not.toBeNull();

        later(PAST_LANDED_WINDOW_MINUTES);
        await reaper.reap();
        const cleaned = await row(upload.objectId);
        expect(cleaned.storage).toBeNull();
        await expect(bytesOf({ ...cleaned, storage: address })).resolves.toBeNull();
      });
    });

    describe("when the cleanup cleared the address and expiry before the bytes landed", () => {
      /** @scenario "Expired pending uploads are reaped on a schedule" */
      it("puts the address back with a deadline the reaper acts on", async () => {
        const {
          service,
          reaper,
          inFlight,
          deleteFailures,
          create,
          send,
          remove,
          row,
          bytesOf,
          later,
        } = fixture();
        const upload = await create();
        const address = (await row(upload.objectId)).storage;
        const release = gate();
        inFlight.holdBefore = release.opened;
        const sending = send(upload).catch((error: unknown) => error);
        await inFlight.started.opened;
        await remove(upload.objectId);
        await service.cleanupDeletedObjects({ projectId: PROJECT_ID });
        deleteFailures.remaining = 1;
        release.open();
        await expect(sending).resolves.toMatchObject({ code: "stored_object_deleted" });

        const kept = await row(upload.objectId);
        expect(kept.storage).toEqual(address);
        expect(kept.expiresAt).not.toBeNull();

        later(PAST_LANDED_WINDOW_MINUTES);
        await reaper.reap();
        await expect(bytesOf({ ...kept, storage: address })).resolves.toBeNull();
        await expect(row(upload.objectId)).resolves.toMatchObject({ storage: null });
      });
    });
  });
});

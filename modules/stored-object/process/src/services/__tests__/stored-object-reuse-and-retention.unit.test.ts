/**
 * @vitest-environment node
 * Reuse by content and owner links, over the memory backends.
 * @see modules/stored-object/specs/stored-object-reuse-and-retention.feature
 */
import { memoryObjectStorage, type ObjectStorage } from "@langwatch/process-stores";
import type {
  StoreStoredObjectFromBytesInput,
  StoredObjectId,
  StoredObjectProjectId,
} from "@langwatch/stored-object-contract";
import { type Instant, Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import {
  FixedStoredObjectDelivery,
  GrantedStoredObjectPermissions,
  MemoryStoredObjectFiles,
  createStoredObjectTestSigner,
} from "../../app/__tests__/stored-object.fixture.ts";
import { MemoryStoredObjectOwnerLinkRepository } from "../../repositories/memory/memory.stored-object-owner-link.repository.ts";
import { MemoryStoredObjectRecordRepository } from "../../repositories/memory/memory.stored-object-record.repository.ts";
import { ObjectStorageStoredObjectBytesRepository } from "../../repositories/object-storage/object-storage.stored-object-bytes.repository.ts";
import type { StoredObjectOwnerLinkRepository } from "../../repositories/stored-object-owner-link.repository.ts";
import { StoredObjectService } from "../stored-object.service.ts";

const PROJECT = "project_reuse" as StoredObjectProjectId;
const OTHER_PROJECT = "project_other" as StoredObjectProjectId;
const DAY_0 = Temporal.Instant.from("2026-11-16T00:00:00.000Z");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function dayOf(day: number): Instant {
  return DAY_0.add({ milliseconds: Math.round(day * 86_400_000) });
}

function fixture(input: { retentionDays?: number } = {}) {
  const records = MemoryStoredObjectRecordRepository.create();
  const memoryLinks = MemoryStoredObjectOwnerLinkRepository.create();
  const clock = { now: DAY_0 };
  const retention = { days: input.retentionDays ?? 30 };
  const inner = memoryObjectStorage();
  const writes: string[] = [];
  const written: Parameters<ObjectStorage["remove"]>[0][] = [];
  const objectStorage: ObjectStorage = {
    ...inner,
    write: (at, body, facts) => {
      writes.push(at.key);
      written.push(at);
      return inner.write(at, body, facts);
    },
  };
  const race = { deleteBeforeLink: false };
  const ownerLinks: StoredObjectOwnerLinkRepository = {
    raise: async (link) => {
      if (race.deleteBeforeLink) {
        race.deleteBeforeLink = false;
        await service.delete({
          projectId: link.tenantId,
          id: link.objectId,
          idempotencyKey: `race:${link.objectId}`,
        });
      }
      await memoryLinks.raise(link);
    },
    countLive: (query) => memoryLinks.countLive(query),
    countAll: (query) => memoryLinks.countAll(query),
    deleteForTenant: (query) => memoryLinks.deleteForTenant(query),
    findTenantsWithExpired: (query) => memoryLinks.findTenantsWithExpired(query),
    findExpired: (query) => memoryLinks.findExpired(query),
    deleteExpired: (query) => memoryLinks.deleteExpired(query),
    retime: (query) => memoryLinks.retime(query),
  };
  const service = StoredObjectService.create({
    records,
    ownerLinks,
    permissions: new GrantedStoredObjectPermissions(),
    storage: ObjectStorageStoredObjectBytesRepository.create({ objectStorage }),
    signer: createStoredObjectTestSigner(),
    legacy: new MemoryStoredObjectFiles(),
    delivery: new FixedStoredObjectDelivery(),
    maximumUploadBytes: 1024 * 1024,
    uploadExpiryMs: 15 * 60 * 1000,
    now: () => clock.now,
  });

  function store(overrides: Partial<StoreStoredObjectFromBytesInput> = {}) {
    return service.storeFromBytes({
      projectId: PROJECT,
      purpose: "trace_content",
      ownerKind: "trace",
      ownerId: "t1",
      filename: "image.png",
      mediaType: "image/png",
      audience: "traces:view",
      bytes: PNG,
      retentionDays: retention.days,
      ...overrides,
    });
  }

  function liveOn(input: { id: string; day: number; projectId?: StoredObjectProjectId }) {
    return memoryLinks.countLive({
      tenantId: input.projectId ?? PROJECT,
      objectId: input.id as StoredObjectId,
      now: dayOf(input.day),
    });
  }

  async function loseBytes() {
    for (const at of written) await inner.remove(at);
  }

  return { service, records, memoryLinks, writes, retention, race, store, liveOn, loseBytes };
}

describe("StoredObjectService.storeFromBytes reuse", () => {
  describe("given the project stored bytes for trace_content as image/png", () => {
    /** @scenario "Identical bytes of the same purpose are stored once" */
    it("answers the first object as a duplicate and writes no second copy", async () => {
      const { store, records, writes } = fixture();
      const first = await store();
      const usage = await records.countActive({ tenantId: PROJECT });

      const second = await store({ ownerId: "t2" });

      expect(second).toEqual({ reference: first.reference, isDuplicate: true });
      expect(first.isDuplicate).toBe(false);
      expect(writes).toHaveLength(1);
      await expect(records.countActive({ tenantId: PROJECT })).resolves.toEqual(usage);
    });

    /** @scenario "Reuse never crosses a purpose, a media type or a project" */
    it("writes its own object for another purpose, media type or project", async () => {
      const { store, writes } = fixture();
      const first = await store();

      const answers = [
        await store({ purpose: "scenario_event", audience: "scenarios:view" }),
        await store({ mediaType: "application/octet-stream" }),
        await store({ projectId: OTHER_PROJECT }),
      ];

      const ids = answers.map((answer) => answer.reference.id);
      expect(answers.every((answer) => !answer.isDuplicate)).toBe(true);
      expect(new Set([first.reference.id, ...ids]).size).toBe(4);
      expect(writes).toHaveLength(4);
    });
  });

  describe("given the project's only object with these bytes is deleted", () => {
    /** @scenario "A deleted object is never reused" */
    it("writes a new object and reports it as not a duplicate", async () => {
      const { service, store, writes } = fixture();
      const first = await store();
      await service.delete({
        projectId: PROJECT,
        id: first.reference.id,
        idempotencyKey: "delete-first",
      });

      const again = await store();

      expect(again.isDuplicate).toBe(false);
      expect(again.reference.id).not.toBe(first.reference.id);
      expect(writes).toHaveLength(2);
    });

    /** @scenario "An object whose bytes are gone is never reused" */
    it("writes a new object when the existing one's provider bytes are missing", async () => {
      const { store, writes, loseBytes } = fixture();
      const first = await store();
      await loseBytes();

      const again = await store();

      expect(again.isDuplicate).toBe(false);
      expect(again.reference.id).not.toBe(first.reference.id);
      expect(writes).toHaveLength(2);
    });
  });

  describe("given an available object whose audiences omit the caller's", () => {
    /** @scenario "A reuse adds the caller's audience" */
    it("adds the caller's audience to the object", async () => {
      const { store, records } = fixture();
      const first = await store({ audience: "project:view" });

      const second = await store({ audience: "traces:view" });

      expect(second.isDuplicate).toBe(true);
      const row = await records.findById({ tenantId: PROJECT, id: first.reference.id });
      expect(row?.audiences).toEqual(["project:view", "traces:view"]);
    });
  });

  describe("given an available trace_content object stored before owner links", () => {
    /** @scenario "An object stored before owner links is never reused for a retained purpose" */
    it("writes a new object for t2 and leaves the older one unlinked", async () => {
      const { store, memoryLinks, writes, liveOn } = fixture();
      const legacy = await store();
      await memoryLinks.deleteForTenant({ tenantId: PROJECT });

      const again = await store({ ownerId: "t2" });

      expect(again.isDuplicate).toBe(false);
      expect(again.reference.id).not.toBe(legacy.reference.id);
      expect(writes).toHaveLength(2);
      await expect(liveOn({ id: again.reference.id, day: 1 })).resolves.toBe(1);
      await expect(
        memoryLinks.countAll({ tenantId: PROJECT, objectId: legacy.reference.id }),
      ).resolves.toBe(0);
    });
  });

  describe("when a delete wins between finding the object and linking to it", () => {
    it("writes fresh bytes and references the new object", async () => {
      const { store, race, writes, liveOn } = fixture();
      const first = await store();
      race.deleteBeforeLink = true;

      const again = await store({ ownerId: "t2" });

      expect(again.isDuplicate).toBe(false);
      expect(again.reference.id).not.toBe(first.reference.id);
      expect(writes).toHaveLength(2);
      await expect(liveOn({ id: again.reference.id, day: 1 })).resolves.toBe(1);
    });
  });
});

describe("StoredObjectService.storeFromBytes owner links", () => {
  describe("given the project keeps traces for 30 days", () => {
    /** @scenario "Storing for a retained purpose links the owner until its retention ends" */
    it("links trace t1 until 30 days from now", async () => {
      const { store, liveOn } = fixture({ retentionDays: 30 });

      const { reference } = await store({ ownerId: "t1" });

      await expect(liveOn({ id: reference.id, day: 29.99 })).resolves.toBe(1);
      await expect(liveOn({ id: reference.id, day: 30 })).resolves.toBe(0);
    });
  });

  describe("given the project keeps traces for 30 days and the store names a retention start", () => {
    /** @scenario "A store whose retention started earlier links the owner from that start" */
    it("links trace t1 until 30 days after a start 20 days ago", async () => {
      const { store, liveOn, memoryLinks } = fixture({ retentionDays: 30 });

      const { reference } = await store({
        ownerId: "t1",
        retainFromMs: dayOf(-20).epochMilliseconds,
      });

      await expect(liveOn({ id: reference.id, day: 9.99 })).resolves.toBe(1);
      await expect(liveOn({ id: reference.id, day: 10 })).resolves.toBe(0);
      await memoryLinks.retime({
        tenantId: PROJECT,
        objectIds: [reference.id as StoredObjectId],
        days: 25,
        at: DAY_0,
      });
      await expect(liveOn({ id: reference.id, day: 4.99 })).resolves.toBe(1);
      await expect(liveOn({ id: reference.id, day: 5 })).resolves.toBe(0);
    });

    /** @scenario "A retention start in the future links the owner from now" */
    it("links trace t1 until 30 days from now", async () => {
      const { store, liveOn } = fixture({ retentionDays: 30 });

      const { reference } = await store({
        ownerId: "t1",
        retainFromMs: dayOf(5).epochMilliseconds,
      });

      await expect(liveOn({ id: reference.id, day: 29.99 })).resolves.toBe(1);
      await expect(liveOn({ id: reference.id, day: 30 })).resolves.toBe(0);
    });
  });

  describe("given trace t1 holds an object until day 30", () => {
    let held: ReturnType<typeof fixture>;
    let objectId: string;

    beforeEach(async () => {
      held = fixture({ retentionDays: 30 });
      objectId = (await held.store({ ownerId: "t1" })).reference.id;
      held.retention.days = 10;
    });

    /** @scenario "A reuse links the new owner without shortening the first" */
    it("links t2 until day 10 and keeps t1 until day 30", async () => {
      const second = await held.store({ ownerId: "t2" });

      expect(second.reference.id).toBe(objectId);
      await expect(held.liveOn({ id: objectId, day: 9 })).resolves.toBe(2);
      await expect(held.liveOn({ id: objectId, day: 11 })).resolves.toBe(1);
      await expect(held.liveOn({ id: objectId, day: 29.99 })).resolves.toBe(1);
      await expect(held.liveOn({ id: objectId, day: 30 })).resolves.toBe(0);
    });

    /** @scenario "Storing again for the same owner raises its link, never lowers it" */
    it("keeps t1 until day 30 when its next store would end on day 10", async () => {
      await held.store({ ownerId: "t1" });

      await expect(held.liveOn({ id: objectId, day: 9 })).resolves.toBe(1);
      await expect(held.liveOn({ id: objectId, day: 29.99 })).resolves.toBe(1);
      await expect(held.liveOn({ id: objectId, day: 30 })).resolves.toBe(0);
    });
  });

  describe("when bytes are stored for a purpose with no retention category", () => {
    /** @scenario "A purpose with no retention category writes no links" */
    it("writes no link", async () => {
      const { store, liveOn } = fixture();

      const { reference } = await store({ purpose: "scenario_event", audience: "scenarios:view" });

      await expect(liveOn({ id: reference.id, day: 0 })).resolves.toBe(0);
    });
  });

  describe("when bytes are stored for a retained purpose without the owner's retention", () => {
    it("refuses before writing anything", async () => {
      const { store, writes } = fixture();

      await expect(store({ retentionDays: undefined })).rejects.toThrow("retentionDays");
      expect(writes).toEqual([]);
    });
  });

  describe("when the project's stored objects are deleted", () => {
    /** @scenario "Deleting a project's objects removes their links" */
    it("leaves none of the project's owner links and keeps another project's", async () => {
      const { service, store, liveOn } = fixture();
      const mine = await store();
      const theirs = await store({ projectId: OTHER_PROJECT });

      await service.deleteOwnedBy({ projectId: PROJECT });

      await expect(liveOn({ id: mine.reference.id, day: 0 })).resolves.toBe(0);
      await expect(
        liveOn({ id: theirs.reference.id, day: 0, projectId: OTHER_PROJECT }),
      ).resolves.toBe(1);
    });
  });
});

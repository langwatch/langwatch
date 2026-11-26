/**
 * @vitest-environment node
 * The owner-link sweep and the retroactive re-time, over the memory backends.
 * @see modules/stored-object/specs/stored-object-reuse-and-retention.feature
 */
import { memoryObjectStorage } from "@langwatch/process-stores";
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
import { StoredObjectRetentionService } from "../stored-object-retention.service.ts";
import { StoredObjectService } from "../stored-object.service.ts";

const PROJECT = "project_sweep" as StoredObjectProjectId;
const OTHER_PROJECT = "project_other" as StoredObjectProjectId;
const DAY_0 = Temporal.Instant.from("2026-11-16T00:00:00.000Z");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);

function dayOf(day: number): Instant {
  return DAY_0.add({ hours: day * 24 });
}

function fixture(input: { sweepPageSize?: number; sweepBudgetMs?: number } = {}) {
  const memoryLinks = MemoryStoredObjectOwnerLinkRepository.create();
  const records = MemoryStoredObjectRecordRepository.create([], memoryLinks);
  const clock = { now: DAY_0 };
  const retention = { days: 30 };
  const race: { beforeRaise?: () => Promise<unknown>; afterRaise?: () => Promise<unknown> } = {};
  const storage = ObjectStorageStoredObjectBytesRepository.create({
    objectStorage: memoryObjectStorage(),
  });
  const cleanup = { refuses: false };
  const sweepPages = { msEach: 0, refuseTenant: undefined as StoredObjectProjectId | undefined };
  const ownerLinks: StoredObjectOwnerLinkRepository = {
    raise: async (link) => {
      const before = race.beforeRaise;
      const after = race.afterRaise;
      race.beforeRaise = undefined;
      race.afterRaise = undefined;
      await before?.();
      await memoryLinks.raise(link);
      await after?.();
    },
    countLive: (query) => memoryLinks.countLive(query),
    countAll: (query) => memoryLinks.countAll(query),
    deleteForTenant: (query) => memoryLinks.deleteForTenant(query),
    findTenantsWithExpired: (query) => memoryLinks.findTenantsWithExpired(query),
    findExpired: async (query) => {
      clock.now = clock.now.add({ milliseconds: sweepPages.msEach });
      return memoryLinks.findExpired(query);
    },
    deleteExpired: async (query) => {
      if (query.tenantId === sweepPages.refuseTenant) throw new Error("interrupted");
      return memoryLinks.deleteExpired(query);
    },
    retime: (query) => memoryLinks.retime(query),
  };
  const service = StoredObjectService.create({
    records,
    ownerLinks,
    permissions: new GrantedStoredObjectPermissions(),
    storage,
    signer: createStoredObjectTestSigner(),
    legacy: new MemoryStoredObjectFiles(),
    delivery: new FixedStoredObjectDelivery(),
    maximumUploadBytes: 1024 * 1024,
    uploadExpiryMs: 15 * 60 * 1000,
    now: () => clock.now,
  });
  const sweeper = StoredObjectRetentionService.create({
    records,
    ownerLinks,
    cleanup: {
      deleteStorageBestEffort: async (target) => {
        if (cleanup.refuses) return false;
        await storage.delete(target);
        return true;
      },
    },
    now: () => clock.now,
    ...(input.sweepPageSize ? { sweepPageSize: input.sweepPageSize } : {}),
    ...(input.sweepBudgetMs ? { sweepBudgetMs: input.sweepBudgetMs } : {}),
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

  async function rowOf(id: string, projectId: StoredObjectProjectId = PROJECT) {
    return records.findById({ tenantId: projectId, id: id as StoredObjectId });
  }

  async function linksOf(id: string, projectId: StoredObjectProjectId = PROJECT) {
    const all = await memoryLinks.findExpired({
      tenantId: projectId,
      before: dayOf(100_000),
      limit: 1_000,
    });
    return all.filter((link) => link.objectId === id);
  }

  return {
    service,
    sweeper,
    records,
    memoryLinks,
    clock,
    retention,
    race,
    cleanup,
    sweepPages,
    store,
    rowOf,
    linksOf,
  };
}

describe("StoredObjectRetentionService.sweep", () => {
  describe("given an object whose only link ended yesterday", () => {
    let f: ReturnType<typeof fixture>;
    let reference: Awaited<ReturnType<ReturnType<typeof fixture>["store"]>>["reference"];

    beforeEach(async () => {
      f = fixture();
      ({ reference } = await f.store());
      f.clock.now = dayOf(31);
    });

    /** @scenario "An object is deleted once its last owner's retention has passed" */
    it("removes the link, deletes the object, refuses its delivery and removes its bytes", async () => {
      const report = await f.sweeper.sweep();

      expect(report).toEqual({ tenants: 1, removedLinks: 1, deletedObjects: 1 });
      expect(await f.linksOf(reference.id)).toEqual([]);
      expect(await f.rowOf(reference.id)).toMatchObject({ status: "deleted", storage: null });
      await expect(
        f.service.getMetadata({ projectId: PROJECT, id: reference.id }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/deleted|not_found/) });
    });

    /** @scenario "An object is deleted once its last owner's retention has passed" */
    it("keeps the bytes' address for the deleted-object cleanup when the provider refuses", async () => {
      f.cleanup.refuses = true;

      await f.sweeper.sweep();

      const row = await f.rowOf(reference.id);
      expect(row?.status).toBe("deleted");
      expect(row?.storage).not.toBeNull();
      const queued = await f.records.findPage({ tenantId: PROJECT, status: "deleted", limit: 10 });
      expect(queued.map((value) => value.id)).toEqual([reference.id]);
    });
  });

  describe("given an object one owner held until yesterday and another holds until next week", () => {
    /** @scenario "An object another owner still holds survives the sweep" */
    it("removes only the ended link and keeps the object available", async () => {
      const f = fixture();
      const { reference } = await f.store({ ownerId: "t1" });
      f.clock.now = dayOf(20);
      await f.store({ ownerId: "t2" });
      f.clock.now = dayOf(31);

      await f.sweeper.sweep();

      expect((await f.linksOf(reference.id)).map((link) => link.ownerId)).toEqual(["t2"]);
      expect((await f.rowOf(reference.id))?.status).toBe("available");
    });
  });

  describe("given an object whose only link has ended", () => {
    let f: ReturnType<typeof fixture>;
    let first: Awaited<ReturnType<ReturnType<typeof fixture>["store"]>>;

    beforeEach(async () => {
      f = fixture();
      first = await f.store({ ownerId: "t1" });
      f.clock.now = dayOf(31);
    });

    /** @scenario "A reuse racing the sweep never references deleted bytes" */
    it("keeps the object when the store's link lands before the sweep", async () => {
      f.race.afterRaise = () => f.sweeper.sweep();

      const second = await f.store({ ownerId: "t2" });

      expect(second).toMatchObject({ isDuplicate: true });
      expect(second.reference.id).toBe(first.reference.id);
      expect((await f.rowOf(first.reference.id))?.status).toBe("available");
      expect((await f.linksOf(first.reference.id)).map((link) => link.ownerId)).toEqual(["t2"]);
    });

    /** @scenario "A reuse racing the sweep never references deleted bytes" */
    it("writes fresh bytes when the sweep deletes the object before the store's link lands", async () => {
      f.race.beforeRaise = () => f.sweeper.sweep();

      const second = await f.store({ ownerId: "t2" });

      expect(second).toMatchObject({ isDuplicate: false });
      expect(second.reference.id).not.toBe(first.reference.id);
      expect((await f.rowOf(first.reference.id))?.status).toBe("deleted");
      expect((await f.rowOf(second.reference.id))?.status).toBe("available");
    });
  });

  describe("given more ended links than one sweep page, across two tenants", () => {
    async function threeEachSide(f: ReturnType<typeof fixture>) {
      for (const byte of [1, 2, 3]) {
        await f.store({ bytes: new Uint8Array([byte]), ownerId: `t${byte}` });
        await f.store({ bytes: new Uint8Array([byte]), projectId: OTHER_PROJECT });
      }
      f.clock.now = dayOf(31);
    }

    /** @scenario "The sweep is bounded and resumable" */
    it("takes a page from each tenant in turn until none is left", async () => {
      const f = fixture({ sweepPageSize: 2 });
      await threeEachSide(f);

      await expect(f.sweeper.sweep()).resolves.toEqual({
        tenants: 2,
        removedLinks: 6,
        deletedObjects: 6,
      });
      await expect(f.sweeper.sweep()).resolves.toEqual({
        tenants: 0,
        removedLinks: 0,
        deletedObjects: 0,
      });
    });

    /** @scenario "The sweep is bounded and resumable" */
    it("stops when its budget ends, after both tenants had a page, and the next run finishes", async () => {
      const f = fixture({ sweepPageSize: 2, sweepBudgetMs: 1_000 });
      await threeEachSide(f);
      f.sweepPages.msEach = 600;

      await expect(f.sweeper.sweep()).resolves.toEqual({
        tenants: 2,
        removedLinks: 4,
        deletedObjects: 4,
      });
      await expect(f.sweeper.sweep()).resolves.toEqual({
        tenants: 2,
        removedLinks: 2,
        deletedObjects: 2,
      });
    });
  });

  describe("given two tenants with ended links, the first of which cannot be swept", () => {
    /** @scenario "One tenant's failure does not stop the sweep for the others" */
    it("sweeps the second, fails the run, and a later run finishes the first", async () => {
      const f = fixture();
      const failing = await f.store({ projectId: OTHER_PROJECT });
      const swept = await f.store();
      f.clock.now = dayOf(31);
      f.sweepPages.refuseTenant = OTHER_PROJECT;

      await expect(f.sweeper.sweep()).rejects.toBeInstanceOf(AggregateError);
      expect((await f.rowOf(swept.reference.id))?.status).toBe("deleted");
      expect(await f.linksOf(swept.reference.id)).toEqual([]);
      expect(await f.linksOf(failing.reference.id, OTHER_PROJECT)).toHaveLength(1);

      f.sweepPages.refuseTenant = undefined;
      await f.sweeper.sweep();

      expect(await f.linksOf(failing.reference.id, OTHER_PROJECT)).toEqual([]);
    });
  });

  describe("given a pinned trace whose media is linked until day 30", () => {
    /** @scenario "Pinning a trace does not extend its media" */
    it("deletes the media on day 31, as the pinned trace's rows are", async () => {
      const f = fixture();
      const { reference } = await f.store({ ownerId: "pinned-trace" });
      f.clock.now = dayOf(31);

      await f.sweeper.sweep();

      expect((await f.rowOf(reference.id))?.status).toBe("deleted");
    });
  });

  describe("given an object stored for a purpose with no retention category", () => {
    /** @scenario "A purpose with no retention category writes no links" */
    it("is never deleted by the sweep", async () => {
      const f = fixture();
      const { reference } = await f.store({
        purpose: "scenario_event",
        audience: "scenarios:view",
      });
      f.clock.now = dayOf(10_000);

      expect(await f.sweeper.sweep()).toEqual({ tenants: 0, removedLinks: 0, deletedObjects: 0 });
      expect((await f.rowOf(reference.id))?.status).toBe("available");
    });
  });

  describe("given a link held with no end date", () => {
    it("never selects it", async () => {
      const f = fixture();
      f.retention.days = 0;
      const { reference } = await f.store();
      f.clock.now = dayOf(10_000);

      await f.sweeper.sweep();

      expect(await f.linksOf(reference.id)).toEqual([]);
      await expect(
        f.memoryLinks.countLive({
          tenantId: PROJECT,
          objectId: reference.id as StoredObjectId,
          now: dayOf(10_000),
        }),
      ).resolves.toBe(1);
      expect((await f.rowOf(reference.id))?.status).toBe("available");
    });
  });
});

describe("StoredObjectRetentionService.followRetention", () => {
  describe("given trace media linked on day 0 under a 30-day retention", () => {
    /** @scenario "Applying a shorter retention to existing traces shortens their media's links" */
    it("ends every trace_content link 7 days after it was created", async () => {
      const f = fixture();
      const { reference } = await f.store();

      await f.sweeper.followRetention({ projectId: PROJECT, category: "traces", retentionDays: 7 });

      expect((await f.linksOf(reference.id)).map((link) => link.retainUntil)).toEqual([dayOf(7)]);
    });
  });

  describe("given trace t1 stored media on day 0 and the same media again on day 20", () => {
    /** @scenario "A re-time counts from the owner's latest store" */
    it("ends the link of t1 on day 27 under a 7-day retention", async () => {
      const f = fixture();
      const { reference } = await f.store({ ownerId: "t1" });
      f.clock.now = dayOf(20);
      await f.store({ ownerId: "t1" });

      await f.sweeper.followRetention({ projectId: PROJECT, category: "traces", retentionDays: 7 });

      expect((await f.linksOf(reference.id)).map((link) => link.retainUntil)).toEqual([dayOf(27)]);
    });
  });

  describe("given trace media linked on day 0 under a 7-day retention", () => {
    /** @scenario "Applying a longer retention to existing traces lengthens their media's links" */
    it("ends every trace_content link 90 days after it was created, and again on redelivery", async () => {
      const f = fixture();
      f.retention.days = 7;
      const { reference } = await f.store();

      await f.sweeper.followRetention({
        projectId: PROJECT,
        category: "traces",
        retentionDays: 90,
      });
      await f.sweeper.followRetention({
        projectId: PROJECT,
        category: "traces",
        retentionDays: 90,
      });

      expect((await f.linksOf(reference.id)).map((link) => link.retainUntil)).toEqual([dayOf(90)]);
    });
  });

  describe("given a new scenarios retention", () => {
    /** @scenario "A retention change in another category leaves trace media alone" */
    it("changes no trace_content link and is not followed at all", async () => {
      const f = fixture();
      const { reference } = await f.store();

      await f.sweeper.followRetention({
        projectId: PROJECT,
        category: "scenarios",
        retentionDays: 7,
      });

      expect((await f.linksOf(reference.id)).map((link) => link.retainUntil)).toEqual([dayOf(30)]);
      expect(f.sweeper.followsCategory({ category: "scenarios" })).toBe(false);
      expect(f.sweeper.followsCategory({ category: "traces" })).toBe(true);
    });
  });
});

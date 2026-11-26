/**
 * @vitest-environment node
 * The owner-link sweep and the retroactive re-time, over the memory backends.
 * @see modules/stored-object/specs/stored-object-reuse-and-retention.feature
 */
import type { StoredObjectId } from "@langwatch/stored-object-contract";
import { beforeEach, describe, expect, it } from "vitest";

import {
  OTHER_PROJECT,
  PROJECT,
  type RetentionFixture,
  dayOf,
  retentionFixture as fixture,
} from "./support/stored-object-retention.support.ts";

describe("StoredObjectRetentionService.sweep", () => {
  describe("given an object whose only link ended yesterday", () => {
    let f: RetentionFixture;
    let reference: Awaited<ReturnType<RetentionFixture["store"]>>["reference"];

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

    /** @scenario "An object is deleted once its last owner's retention has passed" */
    it("retries a refused provider delete on the reaper's next pass", async () => {
      f.cleanup.refuses = true;
      await f.sweeper.sweep();
      f.cleanup.refuses = false;

      await expect(f.reaper.reap()).resolves.toBe(1);

      expect(await f.rowOf(reference.id)).toMatchObject({
        status: "deleted",
        storage: null,
        expiresAt: null,
      });
      await expect(f.reaper.reap()).resolves.toBe(0);
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
    let f: RetentionFixture;
    let first: Awaited<ReturnType<RetentionFixture["store"]>>;

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
    async function threeEachSide(f: RetentionFixture) {
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

  describe("given more tenants with ended links than one run takes", () => {
    /** @scenario "The sweep's tenant list starts with the longest-waiting ended link" */
    it("takes the tenant whose ended link waited longest, not the first by id", async () => {
      const f = fixture({ sweepTenantLimit: 1 });
      const waiting = await f.store();
      f.clock.now = dayOf(5);
      const fresher = await f.store({ projectId: OTHER_PROJECT });
      f.clock.now = dayOf(40);

      await expect(f.sweeper.sweep()).resolves.toMatchObject({ tenants: 1, deletedObjects: 1 });

      expect((await f.rowOf(waiting.reference.id))?.status).toBe("deleted");
      expect((await f.rowOf(fresher.reference.id, OTHER_PROJECT))?.status).toBe("available");
    });
  });

  describe("given an ended link on an object another owner still holds", () => {
    /** @scenario "A re-time during the sweep still lets the sweep delete the object" */
    it("keeps an ended link when a re-time ends the other one, and the next run deletes it", async () => {
      const f = fixture();
      const { reference } = await f.store({ ownerId: "t1" });
      f.clock.now = dayOf(20);
      await f.store({ ownerId: "t2" });
      f.clock.now = dayOf(31);
      f.sweepPages.beforeDelete = () =>
        f.sweeper.followRetention({ projectId: PROJECT, category: "traces", retentionDays: 7 });

      await expect(f.sweeper.sweep()).resolves.toMatchObject({ deletedObjects: 0 });
      expect((await f.rowOf(reference.id))?.status).toBe("available");
      expect(await f.linksOf(reference.id)).not.toEqual([]);

      await expect(f.sweeper.sweep()).resolves.toMatchObject({ deletedObjects: 1 });
      expect((await f.rowOf(reference.id))?.status).toBe("deleted");
      expect(await f.linksOf(reference.id)).toEqual([]);
    });
  });

  describe("given an object whose only link has ended, and a sweep that fails deleting it", () => {
    /** @scenario "A sweep that fails before deleting an object never strands it" */
    it("keeps the ended link, and the next sweep deletes the object", async () => {
      const f = fixture();
      const { reference } = await f.store();
      f.clock.now = dayOf(31);
      const markDeleted = f.records.markDeletedIfUnheld.bind(f.records);
      f.records.markDeletedIfUnheld = async () => {
        f.records.markDeletedIfUnheld = markDeleted;
        throw new Error("the database went away");
      };

      await expect(f.sweeper.sweep()).rejects.toThrow("The sweep failed for 1 tenant(s)");
      expect((await f.rowOf(reference.id))?.status).toBe("available");
      expect(await f.linksOf(reference.id)).toHaveLength(1);

      await expect(f.sweeper.sweep()).resolves.toMatchObject({ deletedObjects: 1 });
      expect((await f.rowOf(reference.id))?.status).toBe("deleted");
      expect(await f.linksOf(reference.id)).toEqual([]);
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

  describe("given two objects of one tenant with ended links, the first of which cannot be updated", () => {
    /** @scenario "One object's failure does not stop the sweep for the rest of its tenant" */
    it("deletes the second, keeps the first's links, fails the run, and a later run finishes", async () => {
      const f = fixture();
      const failing = await f.store({ ownerId: "t1" });
      const swept = await f.store({ ownerId: "t2", bytes: new Uint8Array([1, 2, 3, 4]) });
      f.clock.now = dayOf(31);
      f.sweepPages.refuseObject = failing.reference.id as StoredObjectId;

      await expect(f.sweeper.sweep()).rejects.toBeInstanceOf(AggregateError);
      expect((await f.rowOf(swept.reference.id))?.status).toBe("deleted");
      expect(await f.linksOf(swept.reference.id)).toEqual([]);
      expect(await f.linksOf(failing.reference.id)).toHaveLength(1);

      f.sweepPages.refuseObject = undefined;
      await f.sweeper.sweep();

      expect((await f.rowOf(failing.reference.id))?.status).toBe("deleted");
      expect(await f.linksOf(failing.reference.id)).toEqual([]);
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

describe("StoredObjectService.storeFromBytes", () => {
  describe("given new bytes whose owner link cannot be written", () => {
    /** @scenario "A store whose owner link fails leaves no object behind" */
    it("deletes the new object and its bytes, then fails the store", async () => {
      const f = fixture();
      let written: Awaited<ReturnType<RetentionFixture["records"]["findPage"]>> = [];
      f.race.beforeRaise = async () => {
        written = await f.records.findPage({ tenantId: PROJECT, limit: 10 });
        throw new Error("the link was refused");
      };

      await expect(f.store()).rejects.toThrow("the link was refused");

      const [row] = written;
      const address = row?.storage;
      if (!row || !address) throw new Error("the store wrote no row before linking");
      expect(await f.rowOf(row.id)).toMatchObject({ status: "deleted", storage: null });
      await expect(f.storage.exists({ projectId: PROJECT, address })).resolves.toBe(false);
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

  describe("given trace media linked on day 0 until day 90 and a 30-day policy now", () => {
    /** @scenario "A raise never shortens a media link" */
    it("keeps the day-90 end when the stored rows are raised to 30 days", async () => {
      const f = fixture();
      f.retention.days = 90;
      const { reference } = await f.store();

      await f.sweeper.followRetention({
        projectId: PROJECT,
        category: "traces",
        retentionDays: 30,
        isRaise: true,
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

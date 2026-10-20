import { beforeEach, describe, expect, it } from "vitest";

import type { ProcessRef } from "../../processManager.types.ts";
import { InMemoryProcessStore } from "../inMemoryProcessStore.ts";

const PROCESS_NAME = "graphAlertSweep";
const LEASE_MS = 60_000;
const DUE_AT = 1_500;
const NOW = 2_000;

function ref(processKey: string): ProcessRef {
  return { processName: PROCESS_NAME, projectId: "project-1", processKey };
}

async function armWake(
  store: InMemoryProcessStore,
  target: ProcessRef,
  nextWakeAt: number,
): Promise<void> {
  await store.commit({
    ref: target,
    tenantId: target.projectId,
    sourceEventId: `event-${target.processKey}`,
    expectedRevision: 0,
    state: {},
    nextWakeAt,
    messages: [],
    now: 1_000,
  });
}

function claim(store: InMemoryProcessStore, { now = NOW, limit = 10 } = {}) {
  return store.leaseDueWakes({
    now,
    limit,
    leaseDurationMs: LEASE_MS,
    processNames: [PROCESS_NAME],
  });
}

async function commitNextWake(store: InMemoryProcessStore, revision: number, nextWakeAt: number) {
  return store.commit({
    ref: ref("sweep"),
    tenantId: "project-1",
    sourceEventId: null,
    expectedRevision: revision,
    state: {},
    nextWakeAt,
    messages: [],
    now: NOW,
  });
}

describe("InMemoryProcessStore wake claims", () => {
  describe("given more due wakes than one claim takes", () => {
    describe("when several workers claim at the same moment", () => {
      /** @scenario "Concurrent claims take disjoint batches" */
      it("hands each due wake to exactly one claimer", async () => {
        const store = InMemoryProcessStore.createForTesting();
        const keys = Array.from({ length: 10 }, (_, index) => `sweep-${index}`);
        for (const [index, key] of keys.entries()) await armWake(store, ref(key), DUE_AT + index);

        const batches = await Promise.all([1, 2, 3, 4].map(() => claim(store, { limit: 3 })));

        const handed = batches.flat().map((wake) => wake.ref.processKey);
        expect(new Set(handed).size).toBe(handed.length);
        expect(handed.toSorted()).toEqual(keys.toSorted());
        expect(batches[0]?.map((wake) => wake.ref.processKey)).toEqual([
          "sweep-0",
          "sweep-1",
          "sweep-2",
        ]);
      });
    });
  });

  describe("given a wake due at an instant in the past", () => {
    describe("when a caller finds due wakes", () => {
      /** @scenario "Finding due wakes claims nothing" */
      it("lists the wake every time and leaves it for a claim", async () => {
        const store = InMemoryProcessStore.createForTesting();
        await armWake(store, ref("sweep"), DUE_AT);
        const find = () => store.findDueWakes({ now: NOW, limit: 10 });

        expect(await find()).toEqual([{ ref: ref("sweep"), revision: 1, wakeAt: DUE_AT }]);
        expect(await find()).toEqual([{ ref: ref("sweep"), revision: 1, wakeAt: DUE_AT }]);
        expect((await store.findByRef({ ref: ref("sweep") }))?.nextWakeAt).toBe(DUE_AT);
        expect(await claim(store)).toHaveLength(1);
      });
    });

    describe("when a worker claims it", () => {
      /** @scenario "A claimed wake carries the time it was due" */
      it("reports the due instant and the scheduling revision, not the lease end", async () => {
        const store = InMemoryProcessStore.createForTesting();
        await armWake(store, ref("sweep"), DUE_AT);

        expect(await claim(store)).toEqual([{ ref: ref("sweep"), revision: 1, wakeAt: DUE_AT }]);
        const instance = await store.findByRef({ ref: ref("sweep") });
        expect(instance?.revision).toBe(1);
        expect(instance?.nextWakeAt).toBe(NOW + LEASE_MS);
      });
    });
  });

  describe("given a worker claimed a due wake and never handled it", () => {
    describe("when other workers poll before and after the lease ends", () => {
      /** @scenario "A claimed wake nobody commits or releases fires again after its lease" */
      it("hands it out again at the same revision only once the lease has ended", async () => {
        const store = InMemoryProcessStore.createForTesting();
        await armWake(store, ref("sweep"), DUE_AT);
        await claim(store);

        expect(await claim(store, { now: NOW + LEASE_MS - 1 })).toEqual([]);
        expect(await claim(store, { now: NOW + LEASE_MS })).toEqual([
          { ref: ref("sweep"), revision: 1, wakeAt: NOW + LEASE_MS },
        ]);
      });
    });
  });

  describe("given a worker claimed a due wake", () => {
    describe("when the wake's handler commits a next wake time", () => {
      /** @scenario "A handled wake is next due when its handler said" */
      it("is next due at the handler's time, not at the end of the lease", async () => {
        const store = InMemoryProcessStore.createForTesting();
        await armWake(store, ref("sweep"), DUE_AT);
        const [wake] = await claim(store);
        const handlerNextWakeAt = NOW + 5_000;

        await commitNextWake(store, wake?.revision ?? -1, handlerNextWakeAt);

        expect((await store.findByRef({ ref: ref("sweep") }))?.nextWakeAt).toBe(handlerNextWakeAt);
        expect(await claim(store, { now: handlerNextWakeAt })).toEqual([
          { ref: ref("sweep"), revision: 2, wakeAt: handlerNextWakeAt },
        ]);
      });
    });

    describe("when the worker releases the claim unhandled", () => {
      /** @scenario "A released claim is due again at the time it was first due" */
      it("restores the due instant, so the next claim takes it with that instant", async () => {
        const store = InMemoryProcessStore.createForTesting();
        await armWake(store, ref("sweep"), DUE_AT);
        await claim(store);

        const released = await store.releaseWakeClaim({
          ref: ref("sweep"),
          revision: 1,
          wakeAt: DUE_AT,
          claimedUntil: NOW + LEASE_MS,
        });

        expect(released).toEqual({ applied: true });
        expect((await store.findByRef({ ref: ref("sweep") }))?.nextWakeAt).toBe(DUE_AT);
        expect(await claim(store, { now: NOW + 1 })).toEqual([
          { ref: ref("sweep"), revision: 1, wakeAt: DUE_AT },
        ]);
      });
    });

    describe("when the claim is released after a commit re-armed the wake", () => {
      let store: InMemoryProcessStore;

      beforeEach(async () => {
        store = InMemoryProcessStore.createForTesting();
        await armWake(store, ref("sweep"), DUE_AT);
        await claim(store);
      });

      /** @scenario "Releasing a claim after a commit re-armed the wake changes nothing" */
      it("reports the release as not applied and keeps the commit's wake", async () => {
        await commitNextWake(store, 1, NOW + 5_000);

        const released = await store.releaseWakeClaim({
          ref: ref("sweep"),
          revision: 1,
          wakeAt: DUE_AT,
          claimedUntil: NOW + LEASE_MS,
        });

        expect(released).toEqual({ applied: false });
        expect((await store.findByRef({ ref: ref("sweep") }))?.nextWakeAt).toBe(NOW + 5_000);
      });

      it("keeps a commit's wake even when the commit armed it at the lease end", async () => {
        await commitNextWake(store, 1, NOW + LEASE_MS);

        const released = await store.releaseWakeClaim({
          ref: ref("sweep"),
          revision: 1,
          wakeAt: DUE_AT,
          claimedUntil: NOW + LEASE_MS,
        });

        expect(released).toEqual({ applied: false });
        expect((await store.findByRef({ ref: ref("sweep") }))?.nextWakeAt).toBe(NOW + LEASE_MS);
      });
    });
  });
});

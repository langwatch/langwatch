/**
 * @vitest-environment node
 *
 * Integration coverage against real Postgres for what a fake Prisma client
 * cannot prove: the revision race under optimistic concurrency, and a
 * legacy row whose stateVersion column is NULL.
 */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  LEGACY_STATE_VERSION,
  prismaProcessStore,
  RevisionConflictError,
} from "../prismaProcessStore";

const suffix = nanoid(8);
const PROCESS_NAME = `test-process-${suffix}`;
const PROJECT_ID = `proj_test_${suffix}`;

function key(processKey: string) {
  return { processName: PROCESS_NAME, projectId: PROJECT_ID, processKey };
}

describe("prismaProcessStore (integration)", () => {
  const store = prismaProcessStore(prisma);

  afterAll(async () => {
    await prisma.processManagerInstance.deleteMany({
      where: {
        processName: PROCESS_NAME,
        projectId: { in: [PROJECT_ID, `${PROJECT_ID}-other`] },
      },
    });
  });

  describe("save — optimistic concurrency on revision", () => {
    it("lets only one of two concurrent genesis saves for the same key win", async () => {
      const k = key(`genesis-${nanoid(6)}`);
      const attempt = () =>
        store.save({
          key: k,
          tenantId: "tenant_1",
          state: { count: 1 },
          stateVersion: "v1",
          expectedRevision: 0,
          nextWakeAt: null,
        });

      const results = await Promise.allSettled([attempt(), attempt()]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(RevisionConflictError);

      const row = await store.load(k);
      expect(row?.revision).toBe(1);
    });

    it("lets only one of two concurrent updates at the same expectedRevision win", async () => {
      const k = key(`race-${nanoid(6)}`);
      await store.save({
        key: k,
        tenantId: "tenant_1",
        state: { count: 0 },
        stateVersion: "v1",
        expectedRevision: 0,
        nextWakeAt: null,
      });

      const attempt = (count: number) =>
        store.save({
          key: k,
          tenantId: "tenant_1",
          state: { count },
          stateVersion: "v1",
          expectedRevision: 1,
          nextWakeAt: null,
        });

      const results = await Promise.allSettled([attempt(2), attempt(3)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

      const row = await store.load(k);
      expect(row?.revision).toBe(2);
    });
  });

  describe("load — a legacy row with no stamped stateVersion", () => {
    it("is found (not absent) and is stamped for real on its next save", async () => {
      const k = key(`legacy-${nanoid(6)}`);
      await prisma.processManagerInstance.create({
        data: {
          id: `pminstance_${nanoid(12)}`,
          processName: k.processName,
          projectId: k.projectId,
          processKey: k.processKey,
          tenantId: "tenant_1",
          state: { count: 9 },
          revision: 1,
          stateVersion: null,
          nextWakeAt: null,
          updatedAt: new Date(),
        },
      });

      const loaded = await store.load(k);
      expect(loaded).not.toBeNull();
      expect(loaded?.stateVersion).toBe(LEGACY_STATE_VERSION);
      expect(loaded?.state).toEqual({ count: 9 });
      expect(loaded?.revision).toBe(1);

      await store.save({
        key: k,
        tenantId: "tenant_1",
        state: { count: 10 },
        stateVersion: "real-hash",
        expectedRevision: 1,
        nextWakeAt: null,
      });

      const row = await prisma.processManagerInstance.findUnique({
        where: { projectId: k.projectId, processName_projectId_processKey: k },
      });
      expect(row?.stateVersion).toBe("real-hash");
    });
  });

  describe("due", () => {
    it("returns instances at or before the deadline, ordered, across projects", async () => {
      const now = Date.now();
      const early = key(`due-early-${nanoid(6)}`);
      const late = key(`due-late-${nanoid(6)}`);
      const future = key(`due-future-${nanoid(6)}`);
      const otherProject = {
        processName: PROCESS_NAME,
        projectId: `${PROJECT_ID}-other`,
        processKey: `due-other-${nanoid(6)}`,
      };

      const seeds: [typeof early, number][] = [
        [early, now - 2000],
        [late, now - 1000],
        [future, now + 60_000],
        [otherProject, now - 500],
      ];
      for (const [k, wake] of seeds) {
        await store.save({
          key: k,
          tenantId: "tenant_1",
          state: {},
          stateVersion: "v1",
          expectedRevision: 0,
          nextWakeAt: wake,
        });
      }

      const due = await store.due(now, 50);
      const keys = due.map((d) => d.processKey);
      expect(keys).toContain(early.processKey);
      expect(keys).toContain(late.processKey);
      expect(keys).toContain(otherProject.processKey);
      expect(keys).not.toContain(future.processKey);
      expect(keys.indexOf(early.processKey)).toBeLessThan(
        keys.indexOf(late.processKey),
      );

      await prisma.processManagerInstance.deleteMany({
        where: {
          processKey: otherProject.processKey,
          projectId: otherProject.projectId,
        },
      });
    });
  });
});

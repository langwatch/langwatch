import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_STATE_VERSION,
  prismaProcessStore,
  RevisionConflictError,
} from "../prismaProcessStore";

function createMockPrisma() {
  return {
    processManagerInstance: {
      findUnique: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

const KEY = {
  processName: "billing",
  projectId: "proj_1",
  processKey: "inv_1",
};

describe("prismaProcessStore", () => {
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
  });

  describe("load", () => {
    it("returns null when no row exists", async () => {
      mockPrisma.processManagerInstance.findUnique.mockResolvedValue(null);
      const store = prismaProcessStore(mockPrisma as unknown as PrismaClient);

      const result = await store.load(KEY);

      expect(result).toBeNull();
    });

    it("scopes the lookup by projectId and the compound key", async () => {
      mockPrisma.processManagerInstance.findUnique.mockResolvedValue(null);
      const store = prismaProcessStore(mockPrisma as unknown as PrismaClient);

      await store.load(KEY);

      expect(mockPrisma.processManagerInstance.findUnique).toHaveBeenCalledWith(
        {
          where: {
            projectId: KEY.projectId,
            processName_projectId_processKey: {
              processName: KEY.processName,
              projectId: KEY.projectId,
              processKey: KEY.processKey,
            },
          },
        },
      );
    });

    it("returns the found state with its tenantId and revision", async () => {
      mockPrisma.processManagerInstance.findUnique.mockResolvedValue({
        state: { count: 3 },
        revision: 4,
        tenantId: "tenant_1",
        stateVersion: "abc123",
      });
      const store = prismaProcessStore(mockPrisma as unknown as PrismaClient);

      const result = await store.load(KEY);

      expect(result).toEqual({
        state: { count: 3 },
        revision: 4,
        tenantId: "tenant_1",
        stateVersion: "abc123",
      });
    });

    describe("when the row is a legacy row with no stamped version", () => {
      it("maps NULL to the legacy sentinel rather than treating it as absent", async () => {
        mockPrisma.processManagerInstance.findUnique.mockResolvedValue({
          state: { count: 1 },
          revision: 2,
          tenantId: "tenant_1",
          stateVersion: null,
        });
        const store = prismaProcessStore(mockPrisma as unknown as PrismaClient);

        const result = await store.load(KEY);

        expect(result).not.toBeNull();
        expect(result?.stateVersion).toBe(LEGACY_STATE_VERSION);
        // The state and revision of the legacy row must survive untouched —
        // this is the whole point of not treating it as absent.
        expect(result?.state).toEqual({ count: 1 });
        expect(result?.revision).toBe(2);
      });
    });
  });

  describe("save", () => {
    describe("when expectedRevision is 0 (genesis)", () => {
      it("creates a new row stamped with the given stateVersion", async () => {
        mockPrisma.processManagerInstance.createMany.mockResolvedValue({
          count: 1,
        });
        const store = prismaProcessStore(mockPrisma as unknown as PrismaClient);

        await store.save({
          key: KEY,
          tenantId: "tenant_1",
          state: { count: 1 },
          stateVersion: "v1",
          expectedRevision: 0,
          nextWakeAt: 1000,
        });

        const [{ data }] =
          mockPrisma.processManagerInstance.createMany.mock.calls[0];
        expect(data[0]).toMatchObject({
          processName: KEY.processName,
          projectId: KEY.projectId,
          processKey: KEY.processKey,
          tenantId: "tenant_1",
          revision: 1,
          stateVersion: "v1",
        });
      });

      it("throws RevisionConflictError when a row already won the race", async () => {
        mockPrisma.processManagerInstance.createMany.mockResolvedValue({
          count: 0,
        });
        const store = prismaProcessStore(mockPrisma as unknown as PrismaClient);

        await expect(
          store.save({
            key: KEY,
            tenantId: "tenant_1",
            state: {},
            stateVersion: "v1",
            expectedRevision: 0,
            nextWakeAt: null,
          }),
        ).rejects.toThrow(RevisionConflictError);
      });
    });

    describe("when expectedRevision is non-zero", () => {
      it("issues a single raw UPDATE with revision in the WHERE clause", async () => {
        mockPrisma.$executeRaw.mockResolvedValue(1);
        const store = prismaProcessStore(mockPrisma as unknown as PrismaClient);

        await store.save({
          key: KEY,
          tenantId: "tenant_1",
          state: { count: 2 },
          stateVersion: "v1",
          expectedRevision: 3,
          nextWakeAt: null,
        });

        // `updateMany` must never be used for the CAS: under this schema's
        // relationMode it compiles to SELECT-then-UPDATE-by-id, which only
        // checks revision in the SELECT and lets two racing callers both
        // pass. A hand-written UPDATE is the only statement Postgres
        // evaluates atomically against the row's current revision.
        expect(
          mockPrisma.processManagerInstance.updateMany,
        ).not.toHaveBeenCalled();
        expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
        const call = mockPrisma.$executeRaw.mock.calls[0];
        expect(call).toContain(KEY.projectId);
        expect(call).toContain(KEY.processName);
        expect(call).toContain(KEY.processKey);
        expect(call).toContain(3); // expectedRevision, in the WHERE
        expect(call).toContain(4); // expectedRevision + 1, in the SET
        const sql = (call?.[0] as unknown as string[]).join(" ");
        expect(sql).toContain("revision");
      });

      it("throws RevisionConflictError when the expected revision no longer matches", async () => {
        mockPrisma.$executeRaw.mockResolvedValue(0);
        const store = prismaProcessStore(mockPrisma as unknown as PrismaClient);

        await expect(
          store.save({
            key: KEY,
            tenantId: "tenant_1",
            state: {},
            stateVersion: "v1",
            expectedRevision: 3,
            nextWakeAt: null,
          }),
        ).rejects.toThrow(RevisionConflictError);
      });

      it("stamps the real stateVersion even when the row was legacy before this write", async () => {
        mockPrisma.$executeRaw.mockResolvedValue(1);
        const store = prismaProcessStore(mockPrisma as unknown as PrismaClient);

        await store.save({
          key: KEY,
          tenantId: "tenant_1",
          state: {},
          stateVersion: "freshly-derived-hash",
          expectedRevision: 1,
          nextWakeAt: null,
        });

        const call = mockPrisma.$executeRaw.mock.calls[0];
        expect(call).toContain("freshly-derived-hash");
      });
    });
  });

  describe("due", () => {
    it("maps the raw rows into DueProcessInstance with tenantId and nextWakeAt", async () => {
      const wakeTime = new Date("2026-07-30T00:00:00.000Z");
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          processName: "billing",
          projectId: "proj_1",
          processKey: "inv_1",
          tenantId: "tenant_1",
          nextWakeAt: wakeTime,
        },
      ]);
      const store = prismaProcessStore(mockPrisma as unknown as PrismaClient);

      const due = await store.due(wakeTime.getTime(), 10);

      expect(due).toEqual([
        {
          processName: "billing",
          projectId: "proj_1",
          processKey: "inv_1",
          tenantId: "tenant_1",
          nextWakeAt: wakeTime.getTime(),
        },
      ]);
    });

    it("returns an empty array when nothing is due", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const store = prismaProcessStore(mockPrisma as unknown as PrismaClient);

      const due = await store.due(Date.now(), 10);

      expect(due).toEqual([]);
    });
  });
});

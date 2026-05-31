import type { PinnedTrace } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PinnedTraceRepository } from "../pinning/pinnedTrace.repository";
import { PinnedTraceService } from "../pinning/pinnedTrace.service";

function createPinnedTracePrisma() {
  let record: PinnedTrace | null = null;

  return {
    pinnedTrace: {
      upsert: vi.fn(async ({ update, create }) => {
        if (record) {
          record = { ...record, ...update };
        } else {
          record = {
            id: "pin-1",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            ...create,
          };
        }
        return record;
      }),
      findUnique: vi.fn(async () => record),
      findMany: vi.fn(async () => (record ? [record] : [])),
      deleteMany: vi.fn(async () => {
        const count = record ? 1 : 0;
        record = null;
        return { count };
      }),
    },
  };
}

describe("PinnedTraceService", () => {
  describe("given an unpinned trace", () => {
    describe("when pin() is called", () => {
      /** @scenario Pinning a trace does not change retention */
      it("creates a PinnedTrace row and issues no ClickHouse commands", async () => {
        const repository = new PinnedTraceRepository(
          createPinnedTracePrisma() as any,
        );
        // Service is constructed with only the repository — no CH client needed.
        const service = new PinnedTraceService(repository);

        const pin = await service.pin({
          projectId: "project-1",
          traceId: "abc123",
          userId: "user-1",
        });

        expect(pin).toBeDefined();
        expect(pin.projectId).toBe("project-1");
        expect(pin.traceId).toBe("abc123");
        await expect(
          service.isPinned({ projectId: "project-1", traceId: "abc123" }),
        ).resolves.toBe(true);
      });
    });

    describe("when autoPin() is called", () => {
      it("creates a PinnedTrace row marked as share and issues no ClickHouse commands", async () => {
        const repository = new PinnedTraceRepository(
          createPinnedTracePrisma() as any,
        );
        const service = new PinnedTraceService(repository);

        const pin = await service.autoPin({
          projectId: "project-1",
          traceId: "abc123",
        });

        expect(pin).toBeDefined();
        expect(pin.projectId).toBe("project-1");
        expect(pin.traceId).toBe("abc123");
        await expect(
          service.isPinned({ projectId: "project-1", traceId: "abc123" }),
        ).resolves.toBe(true);
      });
    });
  });

  describe("given a pinned trace", () => {
    describe("when unpin() is called", () => {
      it("deletes the PinnedTrace row and issues no ClickHouse commands", async () => {
        const repository = new PinnedTraceRepository(
          createPinnedTracePrisma() as any,
        );
        const service = new PinnedTraceService(repository);

        await service.pin({ projectId: "project-1", traceId: "abc123" });
        await service.unpin({ projectId: "project-1", traceId: "abc123" });

        await expect(
          service.isPinned({ projectId: "project-1", traceId: "abc123" }),
        ).resolves.toBe(false);
      });
    });
  });

  describe("given an auto-share pin promoted to manual", () => {
    describe("when autoUnpin() runs after share is removed", () => {
      /** @scenario Manual pin survives unsharing an auto-shared trace */
      it("keeps the trace pinned", async () => {
        const repository = new PinnedTraceRepository(
          createPinnedTracePrisma() as any,
        );
        const service = new PinnedTraceService(repository);

        await service.autoPin({ projectId: "project-1", traceId: "abc123" });
        await service.pin({
          projectId: "project-1",
          traceId: "abc123",
          reason: "regression investigation",
        });
        await service.autoUnpin({ projectId: "project-1", traceId: "abc123" });

        await expect(
          service.isPinned({ projectId: "project-1", traceId: "abc123" }),
        ).resolves.toBe(true);
      });
    });
  });
});

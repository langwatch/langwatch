import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaOutbox } from "../prismaOutbox";

function createMockPrisma() {
  return {
    processManagerOutbox: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

describe("prismaOutbox", () => {
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
  });

  describe("stage", () => {
    it("derives processName from the qualified intentType", async () => {
      const outbox = prismaOutbox(mockPrisma as unknown as PrismaClient);

      await outbox.stage([
        {
          intentType: "billing/notifyDigest",
          messageKey: "digest:trace_1",
          tenantId: "tenant_1",
          payload: '{"traceId":"trace_1"}',
        },
      ]);

      const [{ data }] =
        mockPrisma.processManagerOutbox.createMany.mock.calls[0];
      expect(data[0]).toMatchObject({
        processName: "billing",
        intentType: "billing/notifyDigest",
        messageKey: "digest:trace_1",
        tenantId: "tenant_1",
        payload: '{"traceId":"trace_1"}',
        status: "pending",
        attempts: 0,
      });
    });

    it("relies on skipDuplicates so the database collapses a messageKey race", async () => {
      const outbox = prismaOutbox(mockPrisma as unknown as PrismaClient);

      await outbox.stage([
        {
          intentType: "billing/notify",
          messageKey: "digest:trace_1",
          tenantId: "tenant_1",
          payload: "{}",
        },
      ]);

      const [call] = mockPrisma.processManagerOutbox.createMany.mock.calls[0];
      expect(call.skipDuplicates).toBe(true);
    });

    it("does nothing for an empty batch", async () => {
      const outbox = prismaOutbox(mockPrisma as unknown as PrismaClient);

      await outbox.stage([]);

      expect(mockPrisma.processManagerOutbox.createMany).not.toHaveBeenCalled();
    });
  });

  describe("claim", () => {
    it("maps the claimed rows into OutboxRow, renaming attempts to attempt", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          id: "outbox_1",
          intentType: "billing/notify",
          messageKey: "digest:trace_1",
          tenantId: "tenant_1",
          payload: '{"a":1}',
          attempt: 2,
        },
      ]);
      const outbox = prismaOutbox(mockPrisma as unknown as PrismaClient);

      const rows = await outbox.claim(10, 30_000);

      expect(rows).toEqual([
        {
          id: "outbox_1",
          intentType: "billing/notify",
          messageKey: "digest:trace_1",
          tenantId: "tenant_1",
          payload: '{"a":1}',
          attempt: 2,
        },
      ]);
    });

    it("returns an empty array when nothing is claimable", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      const outbox = prismaOutbox(mockPrisma as unknown as PrismaClient);

      const rows = await outbox.claim(10, 30_000);

      expect(rows).toEqual([]);
    });
  });

  describe("settle", () => {
    it("issues a single scoped-by-id update", async () => {
      const outbox = prismaOutbox(mockPrisma as unknown as PrismaClient);

      await outbox.settle("outbox_1");

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe("fail", () => {
    it("schedules a backoff for a retryable failure", async () => {
      const outbox = prismaOutbox(mockPrisma as unknown as PrismaClient);

      await outbox.fail("outbox_1", true, 5000);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("marks a terminal failure dead", async () => {
      const outbox = prismaOutbox(mockPrisma as unknown as PrismaClient);

      await outbox.fail("outbox_1", false, 0);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe("prune", () => {
    it("scopes the delete to the given processName", async () => {
      mockPrisma.$executeRaw.mockResolvedValue(3);
      const outbox = prismaOutbox(mockPrisma as unknown as PrismaClient);

      const removed = await outbox.prune("billing", Date.now());

      expect(removed).toBe(3);
      const call = mockPrisma.$executeRaw.mock.calls[0];
      // Tagged-template call: [strings, ...values] — the process name must
      // be one of the interpolated values, never inlined into the SQL text.
      expect(call).toContain("billing");
      const sql = (call?.[0] as unknown as string[]).join(" ");
      expect(sql).toContain("processName");
      expect(sql).toContain("dispatched");
    });
  });
});

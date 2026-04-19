import type { GatewayAuditLog, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  GatewayAuditService,
  type AuditLogEntry,
} from "../audit.service";

function stubEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  const base: AuditLogEntry = {
    id: "al_01",
    organizationId: "org_01",
    projectId: null,
    actorUserId: "user_01",
    actor: { id: "user_01", name: "Alex", email: "alex@example.com" },
    action: "VIRTUAL_KEY_CREATED",
    targetKind: "virtual_key",
    targetId: "vk_01",
    before: null,
    after: { name: "prod" },
    createdAt: new Date("2026-04-19T10:00:00Z"),
  } as AuditLogEntry;
  return { ...base, ...overrides } as AuditLogEntry;
}

function mockPrisma(entries: AuditLogEntry[]): {
  prisma: PrismaClient;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn(async (args: { take: number }) => {
    return entries.slice(0, args.take);
  });
  const prisma = {
    gatewayAuditLog: { findMany },
  } as unknown as PrismaClient;
  return { prisma, findMany };
}

describe("GatewayAuditService.list", () => {
  describe("when fewer rows than the page limit exist", () => {
    it("returns all entries without a nextCursor", async () => {
      const { prisma, findMany } = mockPrisma([
        stubEntry({ id: "al_02" }),
        stubEntry({ id: "al_01" }),
      ]);
      const sut = GatewayAuditService.create(prisma);

      const page = await sut.list(
        { organizationId: "org_01" },
        { limit: 10 },
      );

      expect(page.entries).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
      expect(findMany.mock.calls[0]?.[0].take).toBe(11);
    });
  });

  describe("when more rows exist than the page limit", () => {
    it("returns exactly `limit` entries and pops the overflow onto nextCursor", async () => {
      const now = new Date("2026-04-19T12:00:00Z");
      const entries = Array.from({ length: 6 }, (_, i) =>
        stubEntry({ id: `al_0${i}`, createdAt: new Date(now.getTime() - i * 1000) }),
      );
      const { prisma } = mockPrisma(entries);
      const sut = GatewayAuditService.create(prisma);

      const page = await sut.list({ organizationId: "org_01" }, { limit: 5 });

      expect(page.entries).toHaveLength(5);
      expect(page.nextCursor).toEqual({
        createdAt: entries[5]?.createdAt.toISOString(),
        id: entries[5]?.id,
      });
    });
  });

  describe("when given an explicit filter", () => {
    it("passes action + targetKind + actor + date range into the prisma WHERE clause", async () => {
      const { prisma, findMany } = mockPrisma([]);
      const sut = GatewayAuditService.create(prisma);

      const fromDate = new Date("2026-04-01T00:00:00Z");
      const toDate = new Date("2026-04-30T00:00:00Z");
      await sut.list(
        {
          organizationId: "org_01",
          action: "VIRTUAL_KEY_REVOKED",
          targetKind: "virtual_key",
          targetId: "vk_99",
          actorUserId: "user_42",
          fromDate,
          toDate,
        },
        { limit: 50 },
      );

      const arg = findMany.mock.calls[0]?.[0];
      expect(arg.where).toMatchObject({
        organizationId: "org_01",
        action: "VIRTUAL_KEY_REVOKED",
        targetKind: "virtual_key",
        targetId: "vk_99",
        actorUserId: "user_42",
        createdAt: { gte: fromDate, lt: toDate },
      });
    });
  });

  describe("when a cursor is supplied", () => {
    it("filters to rows strictly older than the cursor tuple (createdAt, id)", async () => {
      const { prisma, findMany } = mockPrisma([]);
      const sut = GatewayAuditService.create(prisma);

      const cursorAt = new Date("2026-04-19T11:00:00Z");
      await sut.list(
        { organizationId: "org_01" },
        { limit: 50, cursor: { createdAt: cursorAt, id: "al_mid" } },
      );

      const where = findMany.mock.calls[0]?.[0].where;
      expect(where.OR).toEqual([
        { createdAt: { lt: cursorAt } },
        {
          AND: [
            { createdAt: cursorAt },
            { id: { lt: "al_mid" } },
          ],
        },
      ]);
    });
  });

  describe("limit guardrails", () => {
    it("clamps limits above 200 back down to 200", async () => {
      const { prisma, findMany } = mockPrisma([]);
      const sut = GatewayAuditService.create(prisma);

      await sut.list({ organizationId: "org_01" }, { limit: 10_000 });

      expect(findMany.mock.calls[0]?.[0].take).toBe(201);
    });

    it("clamps limits below 1 up to 1", async () => {
      const { prisma, findMany } = mockPrisma([]);
      const sut = GatewayAuditService.create(prisma);

      await sut.list({ organizationId: "org_01" }, { limit: 0 });

      expect(findMany.mock.calls[0]?.[0].take).toBe(2);
    });
  });
});

// Silence unused-var lint for the re-exported type above.
void ({} as GatewayAuditLog | undefined);

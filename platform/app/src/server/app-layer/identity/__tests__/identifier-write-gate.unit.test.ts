import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
  IDENTITY_WRITE_GATE_TTL_MS,
  isUserOnIdentityWrites,
  resetIdentityWriteGateForTests,
} from "../identifier-write-gate";

const USER = "user_sam";

function prismaWithStatus(status: string | null) {
  return {
    systemMigrationTenantState: {
      findUnique: vi.fn(async () => (status === null ? null : { status })),
    },
  } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;
}

afterEach(() => {
  resetIdentityWriteGateForTests();
});

describe("identifier write gate", () => {
  describe("when no backfill row exists for the user", () => {
    it("answers closed — the gate ships closed for everyone", async () => {
      const prisma = prismaWithStatus(null);
      await expect(
        isUserOnIdentityWrites({ userId: USER, prisma }),
      ).resolves.toBe(false);
      expect(prisma.systemMigrationTenantState.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            migrationName_tenantId: {
              migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
              tenantId: USER,
            },
          },
        }),
      );
    });
  });

  describe("when the user's backfill has landed", () => {
    /** @scenario "Finalizing a user's backfill opens their write gate" */
    it("answers open for finalized only; a held (migrated) user stays closed", async () => {
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          prisma: prismaWithStatus("finalized"),
        }),
      ).resolves.toBe(true);
      resetIdentityWriteGateForTests();
      // ADR-110: `migrated` is HELD — the proof found the projection behind
      // or disagreeing, so the user stays on the protocol-only path.
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          prisma: prismaWithStatus("migrated"),
        }),
      ).resolves.toBe(false);
    });

    it("answers closed for parked and rolled_back", async () => {
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          prisma: prismaWithStatus("parked"),
        }),
      ).resolves.toBe(false);
      resetIdentityWriteGateForTests();
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          prisma: prismaWithStatus("rolled_back"),
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when the state table is unreadable", () => {
    it("fails safe to closed", async () => {
      const prisma = {
        systemMigrationTenantState: {
          findUnique: vi.fn(async () => {
            throw new Error("postgres unavailable");
          }),
        },
      } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;
      await expect(
        isUserOnIdentityWrites({ userId: USER, prisma }),
      ).resolves.toBe(false);
    });
  });

  describe("when the backfill finalizes and later an operator rolls back", () => {
    /** @scenario "Finalizing a user's backfill opens their write gate" */
    it("the latch opens on finalized; the rollback pin closes it once the cache TTL elapses", async () => {
      vi.useFakeTimers();
      try {
        await expect(
          isUserOnIdentityWrites({
            userId: USER,
            prisma: prismaWithStatus("finalized"),
          }),
        ).resolves.toBe(true);
        // No cross-pod invalidation exists (ADR-110: rollback applies within
        // the status lookup's cache window). Inside the TTL the pin is not
        // yet seen...
        await expect(
          isUserOnIdentityWrites({
            userId: USER,
            prisma: prismaWithStatus("rolled_back"),
          }),
        ).resolves.toBe(true);
        // ...and the moment the TTL elapses, it is.
        vi.advanceTimersByTime(IDENTITY_WRITE_GATE_TTL_MS + 1);
        await expect(
          isUserOnIdentityWrites({
            userId: USER,
            prisma: prismaWithStatus("rolled_back"),
          }),
        ).resolves.toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when the backfill latches a cached-closed user", () => {
    it("the latch is seen once the cache TTL elapses", async () => {
      vi.useFakeTimers();
      try {
        await expect(
          isUserOnIdentityWrites({
            userId: USER,
            prisma: prismaWithStatus(null),
          }),
        ).resolves.toBe(false);
        vi.advanceTimersByTime(IDENTITY_WRITE_GATE_TTL_MS + 1);
        await expect(
          isUserOnIdentityWrites({
            userId: USER,
            prisma: prismaWithStatus("finalized"),
          }),
        ).resolves.toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

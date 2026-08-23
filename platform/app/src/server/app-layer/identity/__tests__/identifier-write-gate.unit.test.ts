import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
  invalidateIdentityWriteGate,
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
    it("the latch opens on finalized and the rollback pin closes it again", async () => {
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          prisma: prismaWithStatus("finalized"),
        }),
      ).resolves.toBe(true);
      // The runtime's witness invalidates the gate on every transition, so
      // the operator's rolled_back pin takes effect without waiting the TTL.
      invalidateIdentityWriteGate({ userId: USER });
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          prisma: prismaWithStatus("rolled_back"),
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when the backfill latches a cached-closed user", () => {
    it("invalidation reopens the question immediately", async () => {
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          prisma: prismaWithStatus(null),
        }),
      ).resolves.toBe(false);
      invalidateIdentityWriteGate({ userId: USER });
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          prisma: prismaWithStatus("finalized"),
        }),
      ).resolves.toBe(true);
    });
  });
});

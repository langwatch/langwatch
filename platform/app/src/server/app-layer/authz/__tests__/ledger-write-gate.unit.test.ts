/**
 * The per-organization WRITE fork's gate (ADR-092 decision 4).
 *
 * @see specs/rbac/in-place-authz-migration.feature
 */
import { GRANTS_GENESIS_IMPORT_MIGRATION_NAME } from "@langwatch/authz-server/migration";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  isOrgOnLedgerWrites,
  resetLedgerWriteGateForTests,
} from "../ledger-write-gate";

const ORG_ID = "org_gate";

function stateTable(status: string | null) {
  const findUnique = vi
    .fn()
    .mockResolvedValue(status === null ? null : { status });
  return {
    findUnique,
    prisma: {
      systemMigrationTenantState: { findUnique },
    } as unknown as Pick<PrismaClient, "systemMigrationTenantState">,
  };
}

describe("the ledger write gate", () => {
  beforeEach(() => {
    resetLedgerWriteGateForTests();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetLedgerWriteGateForTests();
  });

  describe("when the organization has a genesis import state row", () => {
    it("asks about the genesis import, not any other migration", async () => {
      const { findUnique, prisma } = stateTable("migrated");

      await isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma });

      expect(findUnique.mock.calls[0]![0].where).toEqual({
        migrationName_tenantId: {
          migrationName: GRANTS_GENESIS_IMPORT_MIGRATION_NAME,
          tenantId: ORG_ID,
        },
      });
    });

    it.each([
      ["migrated", true],
      ["finalized", true],
      ["pending", false],
      ["parked", false],
      ["rolled_back", false],
    ])("reads %s as on-ledger=%s", async (status, expected) => {
      const { prisma } = stateTable(status);

      await expect(
        isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(expected);
    });
  });

  describe("when no state row exists at all", () => {
    it("leaves the organization on the legacy path", async () => {
      const { prisma } = stateTable(null);

      await expect(
        isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(false);
    });
  });

  describe("when the state table cannot be read", () => {
    it("fails safe onto the legacy path rather than propagating", async () => {
      const findUnique = vi.fn().mockRejectedValue(new Error("pg is down"));
      const prisma = {
        systemMigrationTenantState: { findUnique },
      } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;

      await expect(
        isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(false);
    });
  });

  describe("when the same organization is asked about repeatedly", () => {
    it("reads the row once inside the cache window", async () => {
      const { findUnique, prisma } = stateTable("migrated");

      await isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma });
      await isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma });
      await isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma });

      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it("keeps one organization's answer out of another's", async () => {
      const { prisma: migrated } = stateTable("migrated");
      const { prisma: pending } = stateTable("pending");

      await expect(
        isOrgOnLedgerWrites({ organizationId: "org_a", prisma: migrated }),
      ).resolves.toBe(true);
      await expect(
        isOrgOnLedgerWrites({ organizationId: "org_b", prisma: pending }),
      ).resolves.toBe(false);
    });
  });

  describe("when the operator flips the row after it was cached", () => {
    /** @scenario "The operator rollback returns an organization's writes to the legacy path without a deploy" */
    it("returns to the legacy path once the cached answer expires, with no restart", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-18T09:00:00.000Z"));
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({ status: "migrated" })
        .mockResolvedValue({ status: "rolled_back" });
      const prisma = {
        systemMigrationTenantState: { findUnique },
      } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;

      await expect(
        isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(true);
      // Still cached: the operator's flip has landed but this pod has not
      // re-read it yet.
      await expect(
        isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(true);

      vi.setSystemTime(new Date("2026-08-18T09:05:00.000Z"));

      await expect(
        isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(false);
      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    /** @scenario "Completing the genesis import moves an organization's writes onto the ledger" */
    it("moves onto the ledger once the import lands and the cached answer expires", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-18T09:00:00.000Z"));
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ status: "migrated" });
      const prisma = {
        systemMigrationTenantState: { findUnique },
      } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;

      await expect(
        isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(false);

      vi.setSystemTime(new Date("2026-08-18T09:05:00.000Z"));

      await expect(
        isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(true);
    });
  });
});

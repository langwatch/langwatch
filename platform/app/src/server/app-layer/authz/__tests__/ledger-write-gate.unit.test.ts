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
  isOrgOnLedgerWritesForRevocation,
  resetLedgerWriteGateForTests,
} from "../ledger-write-gate";
import { authzLedgerWriteGateReadFailuresTotal } from "../metrics";

async function counterValue(): Promise<number> {
  const metric = await authzLedgerWriteGateReadFailuresTotal.get();
  return metric.values[0]?.value ?? 0;
}

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

    it("counts the failure so a reopened legacy-fallback window is observable", async () => {
      const findUnique = vi.fn().mockRejectedValue(new Error("pg is down"));
      const prisma = {
        systemMigrationTenantState: { findUnique },
      } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;
      const before = await counterValue();

      await isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma });

      expect(await counterValue()).toBe(before + 1);
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

/**
 * The revocation class asks the same gate a harder question, because its
 * legacy branch has no repair: a delete with no fact leaves the deciding
 * grant row live on an organization the engine already reads for.
 */
function revocationTables({
  status,
  onEngine,
}: {
  status: string | null;
  onEngine: boolean | null;
}) {
  const state = vi.fn().mockResolvedValue(status === null ? null : { status });
  const cutover = vi
    .fn()
    .mockResolvedValue(onEngine === null ? null : { onEngine });
  return {
    state,
    cutover,
    prisma: {
      systemMigrationTenantState: { findUnique: state },
      authzCutoverProjection: { findUnique: cutover },
    } as unknown as Pick<
      PrismaClient,
      "systemMigrationTenantState" | "authzCutoverProjection"
    >,
  };
}

describe("the ledger write gate, asked by a revocation-class write", () => {
  beforeEach(() => {
    resetLedgerWriteGateForTests();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetLedgerWriteGateForTests();
  });

  describe("when the genesis state row already answers yes", () => {
    it("answers from the cached gate without reading the projection", async () => {
      const { cutover, prisma } = revocationTables({
        status: "finalized",
        onEngine: true,
      });

      await expect(
        isOrgOnLedgerWritesForRevocation({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(true);
      expect(cutover).not.toHaveBeenCalled();
    });
  });

  describe("when a cached legacy answer disagrees with the cutover", () => {
    /** @scenario "A revocation-class write never trusts a cached legacy answer from the write gate" */
    it("routes on the projection, past the answer the cache is still holding", async () => {
      const { state, cutover, prisma } = revocationTables({
        status: "pending",
        onEngine: false,
      });

      await expect(
        isOrgOnLedgerWrites({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(false);
      cutover.mockResolvedValue({ onEngine: true });

      await expect(
        isOrgOnLedgerWritesForRevocation({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(true);
      // The state row is still the cached `false` the mint class keeps
      // reading; the projection is what the revocation asked.
      expect(state).toHaveBeenCalledTimes(1);
      expect(cutover).toHaveBeenCalledTimes(1);
    });

    it("reads the projection again on every revocation, never a cached answer", async () => {
      const { cutover, prisma } = revocationTables({
        status: "pending",
        onEngine: true,
      });

      const ask = () =>
        isOrgOnLedgerWritesForRevocation({ organizationId: ORG_ID, prisma });
      await ask();
      await ask();
      await ask();

      expect(cutover).toHaveBeenCalledTimes(3);
    });
  });

  describe("when the genesis state table cannot be read at all", () => {
    it("still routes a cut-over organization through the ledger", async () => {
      const { prisma, state } = revocationTables({
        status: null,
        onEngine: true,
      });
      state.mockRejectedValue(new Error("pg is down"));

      await expect(
        isOrgOnLedgerWritesForRevocation({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(true);
    });
  });

  describe("when the cutover projection cannot be read", () => {
    /** @scenario "A failed gate read routes a revocation-class write toward the ledger" */
    it("fails toward the ledger rather than the branch that appends nothing", async () => {
      const { cutover, prisma } = revocationTables({
        status: "pending",
        onEngine: false,
      });
      cutover.mockRejectedValue(new Error("projection unavailable"));

      await expect(
        isOrgOnLedgerWritesForRevocation({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(true);
    });

    it("counts the failure so the diverted window is observable", async () => {
      const { cutover, prisma } = revocationTables({
        status: "pending",
        onEngine: false,
      });
      cutover.mockRejectedValue(new Error("projection unavailable"));
      const before = await counterValue();

      await isOrgOnLedgerWritesForRevocation({
        organizationId: ORG_ID,
        prisma,
      });

      expect(await counterValue()).toBe(before + 1);
    });
  });

  describe("when neither the state row nor the projection names the organization", () => {
    it("leaves the revocation on the legacy path", async () => {
      const { prisma } = revocationTables({ status: null, onEngine: null });

      await expect(
        isOrgOnLedgerWritesForRevocation({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(false);
    });
  });
});

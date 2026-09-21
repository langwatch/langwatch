/**
 * The per-organization WRITE fork's gate (ADR-092 decision 4).
 *
 * @see specs/migration/authz-grants-rollout.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  ENGINE_GATE_CACHE_TTL_MS,
  organizationOnAuthzEngine,
  readOrganizationOnAuthzEngine,
  resetAuthzEngineGateForTesting,
  setAuthzEngineGateFailureReporter,
} from "../engine-gate";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "../migration-name";

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

describe("the authz engine gate", () => {
  beforeEach(() => {
    resetAuthzEngineGateForTesting();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAuthzEngineGateForTesting();
  });

  describe("when the organization has an authz migration state row", () => {
    it("asks about the authz migration, not any other", async () => {
      const { findUnique, prisma } = stateTable("finalized");

      await organizationOnAuthzEngine({ organizationId: ORG_ID, prisma });

      expect(findUnique.mock.calls[0]![0].where).toEqual({
        migrationName_tenantId: {
          migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
          tenantId: ORG_ID,
        },
      });
    });

    it.each([
      ["migrated", false],
      ["finalized", true],
      ["pending", false],
      ["parked", false],
      ["rolled_back", false],
    ])("reads %s as on-ledger=%s", async (status, expected) => {
      const { prisma } = stateTable(status);

      await expect(
        organizationOnAuthzEngine({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(expected);
    });
  });

  describe("when no state row exists at all", () => {
    it("leaves the organization on the legacy path", async () => {
      const { prisma } = stateTable(null);

      await expect(
        organizationOnAuthzEngine({ organizationId: ORG_ID, prisma }),
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
        organizationOnAuthzEngine({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(false);
    });

    // The gate cannot count this itself: prom-client runs at import time and
    // the browser imports this module through `rbac.ts`, so the counter lives
    // in the server composition and reaches the gate as an installed reporter.
    // What the gate owes is the CALL — that a failed read is reported at all,
    // with the organization and the window it reopened.
    /** @scenario "A failed migration-state read is reported" */
    it("reports the failure so a reopened legacy-fallback window is observable", async () => {
      const findUnique = vi.fn().mockRejectedValue(new Error("pg is down"));
      const prisma = {
        systemMigrationTenantState: { findUnique },
      } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;
      const reported: unknown[] = [];
      setAuthzEngineGateFailureReporter((args) => reported.push(args));

      await organizationOnAuthzEngine({ organizationId: ORG_ID, prisma });

      expect(reported).toEqual([
        {
          organizationId: ORG_ID,
          error: expect.any(Error),
          ttlMs: ENGINE_GATE_CACHE_TTL_MS,
        },
      ]);
      setAuthzEngineGateFailureReporter(() => undefined);
    });

    /**
     * The fail-safe direction is right for a CHECK and wrong for a REVOKE.
     * A check that cannot read the state stays on the legacy path, which
     * always answers; a revoke that did the same would write the legacy head
     * alone, leaving the grant live and the access it was told to remove
     * still working.
     *
     * So revocation routes on `readOrganizationOnAuthzEngine`, which raises,
     * and treats raising as "on the engine". This pins the raising: when the
     * two functions were one, its caller's catch became unreachable and the
     * revoke silently took the legacy-only branch.
     */
    it("raises through the uncached read a revoke routes on", async () => {
      const findUnique = vi.fn().mockRejectedValue(new Error("pg is down"));
      const prisma = {
        systemMigrationTenantState: { findUnique },
      } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;

      await expect(
        readOrganizationOnAuthzEngine({ organizationId: ORG_ID, prisma }),
      ).rejects.toThrow("pg is down");
    });
  });

  describe("when the same organization is asked about repeatedly", () => {
    it("reads the row once inside the cache window", async () => {
      const { findUnique, prisma } = stateTable("finalized");

      await organizationOnAuthzEngine({ organizationId: ORG_ID, prisma });
      await organizationOnAuthzEngine({ organizationId: ORG_ID, prisma });
      await organizationOnAuthzEngine({ organizationId: ORG_ID, prisma });

      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    it("keeps one organization's answer out of another's", async () => {
      const { prisma: finalized } = stateTable("finalized");
      const { prisma: pending } = stateTable("pending");

      await expect(
        organizationOnAuthzEngine({
          organizationId: "org_a",
          prisma: finalized,
        }),
      ).resolves.toBe(true);
      await expect(
        organizationOnAuthzEngine({ organizationId: "org_b", prisma: pending }),
      ).resolves.toBe(false);
    });
  });

  describe("when the operator flips the row after it was cached", () => {
    /** @scenario "Rolling back returns an organization to the legacy path within the gate's cache window" */
    it("returns to the legacy path once the cached answer expires, with no restart", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-18T09:00:00.000Z"));
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({ status: "finalized" })
        .mockResolvedValue({ status: "rolled_back" });
      const prisma = {
        systemMigrationTenantState: { findUnique },
      } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;

      await expect(
        organizationOnAuthzEngine({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(true);
      // Still cached: the operator's flip has landed but this pod has not
      // re-read it yet.
      await expect(
        organizationOnAuthzEngine({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(true);

      vi.setSystemTime(new Date("2026-08-18T09:05:00.000Z"));

      await expect(
        organizationOnAuthzEngine({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(false);
      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    /** @scenario "Completing the authz migration moves an organization's writes onto the ledger" */
    it("moves onto the ledger once the import lands and the cached answer expires", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-18T09:00:00.000Z"));
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ status: "finalized" });
      const prisma = {
        systemMigrationTenantState: { findUnique },
      } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;

      await expect(
        organizationOnAuthzEngine({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(false);

      vi.setSystemTime(new Date("2026-08-18T09:05:00.000Z"));

      await expect(
        organizationOnAuthzEngine({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(true);
    });
  });
});

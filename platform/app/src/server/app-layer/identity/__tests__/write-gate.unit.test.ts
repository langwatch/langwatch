import type {
  SystemMigrationStateRepository,
  TenantMigrationStatus,
} from "@langwatch/system-migrations";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../migration-name";
import {
  IDENTITY_WRITE_GATE_TTL_MS,
  isUserOnIdentityWrites,
  resetIdentityWriteGateForTests,
} from "../write-gate";

const USER = "user_sam";

function stateWithStatus(
  status: TenantMigrationStatus | null,
): SystemMigrationStateRepository {
  return {
    findRecord: vi.fn(
      async ({
        migrationName,
        tenantId,
      }: {
        migrationName: string;
        tenantId: string;
      }) =>
        status === null
          ? null
          : { migrationName, tenantId, status, report: null },
    ),
    upsertRecord: vi.fn(async () => undefined),
    upsertRecordUnlessRolledBack: vi.fn(async () => true),
    // The global short-circuit's read. A suite that stubs a per-user status
    // is by definition past the "has anyone finalized" question, so the
    // default answers yes and each test still proves its own fork.
    hasFinalizedTenant: vi.fn(async () => true),
  };
}

afterEach(() => {
  resetIdentityWriteGateForTests();
});

describe("identifier write gate", () => {
  describe("when nobody has finalized the migration yet", () => {
    /** @scenario "The gate costs nothing before anyone is enrolled" */
    it("answers closed without reading the user's own row at all", async () => {
      const state = stateWithStatus("finalized");
      (state.hasFinalizedTenant as ReturnType<typeof vi.fn>).mockResolvedValue(
        false,
      );

      await expect(
        isUserOnIdentityWrites({ userId: USER, state }),
      ).resolves.toBe(false);
      // The whole point of the short-circuit: no per-user read is issued.
      expect(state.findRecord).not.toHaveBeenCalled();
    });

    it("reads once per pod, not once per user", async () => {
      const state = stateWithStatus("finalized");
      (state.hasFinalizedTenant as ReturnType<typeof vi.fn>).mockResolvedValue(
        false,
      );

      await isUserOnIdentityWrites({ userId: "user_a", state });
      await isUserOnIdentityWrites({ userId: "user_b", state });
      await isUserOnIdentityWrites({ userId: "user_c", state });

      expect(state.hasFinalizedTenant).toHaveBeenCalledTimes(1);
    });
  });

  describe("when no backfill row exists for the user", () => {
    it("answers closed — the gate ships closed for everyone", async () => {
      const state = stateWithStatus(null);
      await expect(
        isUserOnIdentityWrites({ userId: USER, state }),
      ).resolves.toBe(false);
      expect(state.findRecord).toHaveBeenCalledWith({
        migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        tenantId: USER,
      });
    });
  });

  describe("when the user's backfill has landed", () => {
    /** @scenario "Finalizing a user's backfill opens their write gate" */
    it("answers open for finalized only; a held (migrated) user stays closed", async () => {
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          state: stateWithStatus("finalized"),
        }),
      ).resolves.toBe(true);
      resetIdentityWriteGateForTests();
      // ADR-110: `migrated` is HELD — the proof found the projection behind
      // or disagreeing, so the user stays on the protocol-only path.
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          state: stateWithStatus("migrated"),
        }),
      ).resolves.toBe(false);
    });

    it("answers closed for parked and rolled_back", async () => {
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          state: stateWithStatus("parked"),
        }),
      ).resolves.toBe(false);
      resetIdentityWriteGateForTests();
      await expect(
        isUserOnIdentityWrites({
          userId: USER,
          state: stateWithStatus("rolled_back"),
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when the state table is unreadable", () => {
    it("fails safe to closed", async () => {
      const state: SystemMigrationStateRepository = {
        findRecord: vi.fn(async () => {
          throw new Error("postgres unavailable");
        }),
        upsertRecord: vi.fn(async () => undefined),
        upsertRecordUnlessRolledBack: vi.fn(async () => true),
        // Load-bearing `true`: the anyone-gate short-circuits a `false`
        // before the per-user read runs, so stubbing it closed would pass
        // this test without ever reaching the `findRecord` that throws.
        hasFinalizedTenant: vi.fn(async () => true),
      };
      await expect(
        isUserOnIdentityWrites({ userId: USER, state }),
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
            state: stateWithStatus("finalized"),
          }),
        ).resolves.toBe(true);
        // No cross-pod invalidation exists (ADR-110: rollback applies within
        // the status lookup's cache window). Inside the TTL the pin is not
        // yet seen...
        await expect(
          isUserOnIdentityWrites({
            userId: USER,
            state: stateWithStatus("rolled_back"),
          }),
        ).resolves.toBe(true);
        // ...and the moment the TTL elapses, it is.
        vi.advanceTimersByTime(IDENTITY_WRITE_GATE_TTL_MS + 1);
        await expect(
          isUserOnIdentityWrites({
            userId: USER,
            state: stateWithStatus("rolled_back"),
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
            state: stateWithStatus(null),
          }),
        ).resolves.toBe(false);
        vi.advanceTimersByTime(IDENTITY_WRITE_GATE_TTL_MS + 1);
        await expect(
          isUserOnIdentityWrites({
            userId: USER,
            state: stateWithStatus("finalized"),
          }),
        ).resolves.toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

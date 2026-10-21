import { describe, expect, it, vi } from "vitest";

import { MemoryIdentityLatchRepository } from "../../repositories/memory/memory.identity-latch.repository.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../rules/identity-migration-names.rules.ts";
import { IdentityIdentifierBackfillMigrationService } from "../system-migration-identity-identifier-backfill.service.ts";

describe("the identifier backfill migration", () => {
  describe("when the runner drives a tenant", () => {
    /** @scenario "The backfill adopts existing accounts and proves itself per user" */
    /** @scenario "The identifier backfill waits for enrollment and migrates one user per tenant" */
    it("hands the tenant to the backfill service as the user and returns its outcome", async () => {
      const migrateUser = vi.fn(async () => ({
        status: "migrated" as const,
        report: { kind: "parity" as const, diffs: [] },
      }));
      const migration = IdentityIdentifierBackfillMigrationService.create({
        latch: MemoryIdentityLatchRepository.create(MemoryIdentityStore.create()),
        backfill: { migrateUser },
        maxQueuedJobs: 5_000,
      });

      const outcome = await migration.migrateTenant({ tenantId: "user_sam" });

      expect(migrateUser).toHaveBeenCalledWith({ userId: "user_sam" });
      expect(outcome).toEqual({
        status: "migrated",
        report: { kind: "parity", diffs: [] },
      });
    });
  });

  describe("when the backfill holds a user", () => {
    function holding(report: { kind: "parity"; diffs: [] } | { kind: "unproven_account" }) {
      return IdentityIdentifierBackfillMigrationService.create({
        latch: MemoryIdentityLatchRepository.create(MemoryIdentityStore.create()),
        backfill: { migrateUser: vi.fn(async () => ({ status: "migrated" as const, report })) },
        maxQueuedJobs: 5_000,
      });
    }

    /** @scenario "The identifier backfill holds an unproven account on the person and a disagreeing proof on the proof" */
    it("holds an unproven account on the person", async () => {
      const outcome = await holding({ kind: "unproven_account" }).migrateTenant({
        tenantId: "user_sam",
      });

      expect(outcome).toEqual({
        status: "migrated",
        report: { kind: "unproven_account" },
        heldReason: "person",
      });
    });

    /** @scenario "The identifier backfill holds an unproven account on the person and a disagreeing proof on the proof" */
    it("leaves a disagreeing proof on the default reason", async () => {
      const outcome = await holding({ kind: "parity", diffs: [] }).migrateTenant({
        tenantId: "user_kim",
      });

      expect(outcome).not.toHaveProperty("heldReason");
    });
  });

  describe("when the runner reads its declaration", () => {
    /** @scenario "Finalizing a user's backfill opens their write gate" */
    /** @scenario "The identifier backfill waits for enrollment and migrates one user per tenant" */
    it("registers under the name the write gate reads, operator-free and run automatically", () => {
      const migration = IdentityIdentifierBackfillMigrationService.create({
        latch: MemoryIdentityLatchRepository.create(MemoryIdentityStore.create()),
        backfill: { migrateUser: vi.fn() },
        maxQueuedJobs: 5_000,
      });
      expect(migration.name).toBe(IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME);
      expect(migration.requiresOperatorConfirmation).toBe(false);
      expect(migration.runsAutomaticallyOnSelfHosted).toBe(true);
      expect(migration.enrolledAutomatically).toBe(true);
    });
  });
});

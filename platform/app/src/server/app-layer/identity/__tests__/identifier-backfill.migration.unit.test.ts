import { describe, expect, it, vi } from "vitest";
import { IdentityIdentifierBackfillMigration } from "../identifier-backfill.migration";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../migration-name";

describe("the identifier backfill migration", () => {
  describe("when the runner drives a tenant", () => {
    /** @scenario "The backfill adopts existing accounts and proves itself per user" */
    it("hands the tenant to the backfill service as the user and returns its outcome", async () => {
      const migrateUser = vi.fn(async () => ({
        status: "migrated" as const,
        report: { kind: "parity" as const, diffs: [] },
      }));
      const migration = new IdentityIdentifierBackfillMigration({
        migrateUser,
      });

      const outcome = await migration.migrateTenant({ tenantId: "user_sam" });

      expect(migrateUser).toHaveBeenCalledWith({ userId: "user_sam" });
      expect(outcome).toEqual({
        status: "migrated",
        report: { kind: "parity", diffs: [] },
      });
    });
  });

  describe("when the runner reads its declaration", () => {
    /** @scenario "Finalizing a user's backfill opens their write gate" */
    it("registers under the name the write gate reads, operator-free, and runs itself when self-hosted", () => {
      const migration = new IdentityIdentifierBackfillMigration({
        migrateUser: vi.fn(),
      });
      expect(migration.name).toBe(IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME);
      expect(migration.requiresOperatorConfirmation).toBe(false);
      // A self-hosted installation includes every organization in any
      // migration it runs at all, so this is what gives a self-hosted user an
      // identity history — and the front door now needs one to find them.
      expect(migration.runsAutomaticallyOnSelfHosted).toBe(true);
      // Still paced by enrollment on cloud: the identity rollout has not
      // finished, so deploying it must keep changing nothing until an
      // operator enrolls an organization.
      expect(migration.enrolledAutomatically).toBe(false);
    });
  });
});

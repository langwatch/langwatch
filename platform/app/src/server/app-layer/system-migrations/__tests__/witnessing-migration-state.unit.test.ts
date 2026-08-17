import type { TenantMigrationRecord } from "@langwatch/system-migrations";
import { describe, expect, it, vi } from "vitest";
import { WitnessingSystemMigrationStateRepository } from "../repositories/witnessing-migration-state.repository";
import type { SystemMigrationStateReader } from "../system-migrations.service";

const RECORD: TenantMigrationRecord = {
  migrationName: "authz-team-user-backfill",
  tenantId: "org_acme",
  status: "finalized",
  report: { kind: "parity_clean", backfilled: 3, usersVerified: 3 },
};

function makeInner(): SystemMigrationStateReader {
  return {
    findRecord: vi.fn(async () => null),
    findStatusCounts: vi.fn(async () => ({
      migrated: 0,
      finalized: 0,
      parked: 0,
      rolled_back: 0,
    })),
    findRecordsByStatus: vi.fn(async () => []),
    upsertRecord: vi.fn(async () => undefined),
  };
}

describe("WitnessingSystemMigrationStateRepository", () => {
  describe("when a lifecycle transition is written", () => {
    /** @scenario "Runner lifecycle transitions are witnessed as ledger facts" */
    it("writes the state synchronously and witnesses it with a post-write timestamp", async () => {
      const inner = makeInner();
      const witness = vi.fn(async () => undefined);
      const repository = new WitnessingSystemMigrationStateRepository(
        inner,
        witness,
        () => 1_700_000_000_123,
      );

      await repository.upsertRecord(RECORD);

      expect(inner.upsertRecord).toHaveBeenCalledWith(RECORD);
      expect(witness).toHaveBeenCalledWith({
        migrationName: RECORD.migrationName,
        tenantId: RECORD.tenantId,
        status: "finalized",
        report: RECORD.report,
        occurredAtMs: 1_700_000_000_123,
      });
      // The direct write happened before the witness - the latch never
      // waits on the ledger.
      expect(
        vi.mocked(inner.upsertRecord).mock.invocationCallOrder[0],
      ).toBeLessThan(witness.mock.invocationCallOrder[0]!);
    });
  });

  describe("when the witness fails", () => {
    /** @scenario "A lost witness never loses a transition" */
    it("keeps the state write and swallows the failure", async () => {
      const inner = makeInner();
      const witness = vi.fn(async () => {
        throw new Error("redis is gone");
      });
      const repository = new WitnessingSystemMigrationStateRepository(
        inner,
        witness,
        () => 1,
      );

      await expect(repository.upsertRecord(RECORD)).resolves.toBeUndefined();
      expect(inner.upsertRecord).toHaveBeenCalledTimes(1);
    });
  });
});

import type { TenantMigrationRecord } from "@langwatch/system-migrations";
import { describe, expect, it, vi } from "vitest";
import {
  MigrationRollbackRequiresMigratedOrFinalizedError,
  MigrationStateNotFoundError,
} from "../errors";
import { SystemMigrationsService } from "../system-migrations.service";

const MIGRATION = "team-user-backfill";
const TENANT = "org_acme";

function serviceWith({ record }: { record: TenantMigrationRecord | null }) {
  const upserts: TenantMigrationRecord[] = [];
  const service = new SystemMigrationsService({
    state: {
      findStatusCounts: vi.fn(),
      findRecordsByStatus: vi.fn(),
      findRecord: vi.fn().mockResolvedValue(record),
      upsertRecord: vi.fn().mockImplementation((written) => {
        upserts.push(written as TenantMigrationRecord);
        return Promise.resolve();
      }),
    },
    migrationNames: () => [MIGRATION],
    runPass: vi.fn(),
  });
  return { service, upserts };
}

describe("SystemMigrationsService.rollBack", () => {
  describe("given a finalized organization", () => {
    const finalized: TenantMigrationRecord = {
      migrationName: MIGRATION,
      tenantId: TENANT,
      status: "finalized",
      report: { parity: "clean" },
    };

    describe("when an operator rolls it back", () => {
      /** @scenario "An operator rolls a finalized organization back to its legacy path" */
      it("writes rolled_back and records who did it, keeping the prior report", async () => {
        const { service, upserts } = serviceWith({ record: finalized });
        await service.rollBack({
          migrationName: MIGRATION,
          tenantId: TENANT,
          actorUserId: "user_alex",
        });
        expect(upserts).toHaveLength(1);
        const written = upserts[0]!;
        expect(written.status).toBe("rolled_back");
        const report = written.report as Record<string, unknown>;
        expect(report.parity).toBe("clean");
        expect(report.rolledBack).toMatchObject({ by: "user_alex" });
      });
    });
  });

  describe("given a migrated organization", () => {
    const migrated: TenantMigrationRecord = {
      migrationName: MIGRATION,
      tenantId: TENANT,
      status: "migrated",
      report: { diffs: ["budgets:view at org"] },
    };

    describe("when an operator rolls it back", () => {
      /** @scenario "An operator rolls a migrated organization back to its legacy path" */
      it("writes rolled_back and records who did it, keeping the prior report", async () => {
        const { service, upserts } = serviceWith({ record: migrated });
        await service.rollBack({
          migrationName: MIGRATION,
          tenantId: TENANT,
          actorUserId: "user_alex",
        });
        expect(upserts).toHaveLength(1);
        const written = upserts[0]!;
        expect(written.status).toBe("rolled_back");
        const report = written.report as Record<string, unknown>;
        expect(report.diffs).toEqual(["budgets:view at org"]);
        expect(report.rolledBack).toMatchObject({ by: "user_alex" });
      });
    });
  });

  describe("given an organization the migration never processed", () => {
    it("refuses with migration_state_not_found and writes nothing", async () => {
      const { service, upserts } = serviceWith({ record: null });
      await expect(
        service.rollBack({
          migrationName: MIGRATION,
          tenantId: TENANT,
          actorUserId: "user_alex",
        }),
      ).rejects.toThrow(MigrationStateNotFoundError);
      expect(upserts).toHaveLength(0);
    });
  });

  describe("given an organization that is parked rather than migrated or finalized", () => {
    it("refuses with migration_rollback_requires_migrated_or_finalized, naming the actual status", async () => {
      const { service, upserts } = serviceWith({
        record: {
          migrationName: MIGRATION,
          tenantId: TENANT,
          status: "parked",
          report: null,
        },
      });
      const attempt = service.rollBack({
        migrationName: MIGRATION,
        tenantId: TENANT,
        actorUserId: "user_alex",
      });
      await expect(attempt).rejects.toThrow(
        MigrationRollbackRequiresMigratedOrFinalizedError,
      );
      await attempt.catch(
        (error: MigrationRollbackRequiresMigratedOrFinalizedError) => {
          expect(error.code).toBe(
            "migration_rollback_requires_migrated_or_finalized",
          );
          expect(error.meta).toMatchObject({ status: "parked" });
        },
      );
      expect(upserts).toHaveLength(0);
    });
  });

  describe("given an organization that is already rolled back", () => {
    it("refuses with migration_rollback_requires_migrated_or_finalized and writes nothing", async () => {
      const { service, upserts } = serviceWith({
        record: {
          migrationName: MIGRATION,
          tenantId: TENANT,
          status: "rolled_back",
          report: null,
        },
      });
      await expect(
        service.rollBack({
          migrationName: MIGRATION,
          tenantId: TENANT,
          actorUserId: "user_alex",
        }),
      ).rejects.toThrow(MigrationRollbackRequiresMigratedOrFinalizedError);
      expect(upserts).toHaveLength(0);
    });
  });
});

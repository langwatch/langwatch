import type { TenantMigrationRecord } from "@langwatch/system-migrations";
import { describe, expect, it, vi } from "vitest";
import {
  MigrationRollbackRequiresMigratedOrFinalizedError,
  MigrationStateNotFoundError,
} from "../errors";
import { SystemMigrationsService } from "../system-migrations.service";

const MIGRATION = "team-user-backfill";
const TENANT = "org_acme";

function serviceWith({
  record,
  rollbackEffects,
}: {
  record: TenantMigrationRecord | null;
  rollbackEffects?: Record<
    string,
    (args: {
      tenantId: string;
      actorUserId: string;
      decidedAt: string;
    }) => Promise<void>
  >;
}) {
  const upserts: TenantMigrationRecord[] = [];
  // Stored, not fixed: a rollback retry re-reads the record the previous call
  // pinned, so the stub has to answer with what was actually written.
  let stored = record;
  const service = new SystemMigrationsService({
    state: {
      findStatusCounts: vi.fn(),
      findRecordsByStatus: vi.fn(),
      findRecord: vi.fn().mockImplementation(() => Promise.resolve(stored)),
      upsertRecord: vi.fn().mockImplementation((written) => {
        stored = written as TenantMigrationRecord;
        upserts.push(written as TenantMigrationRecord);
        return Promise.resolve();
      }),
    },
    migrationNames: () => [MIGRATION],
    runPass: vi.fn(),
    ...(rollbackEffects ? { rollbackEffects } : {}),
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

    describe("when the rolled-back migration carries an effect of its own", () => {
      /** @scenario "Rolling back a cutover takes effect without a deploy, even with the queue stopped" */
      it("runs the effect after the pin is written, and only for that migration", async () => {
        let written: TenantMigrationRecord[] = [];
        const seen = { pinsAtEffect: -1 };
        const effect = vi.fn(async () => {
          seen.pinsAtEffect = written.length;
        });
        const otherEffect = vi.fn();
        const { service, upserts } = serviceWith({
          record: finalized,
          rollbackEffects: {
            [MIGRATION]: effect,
            "some-other-migration": otherEffect,
          },
        });
        written = upserts;

        await service.rollBack({
          migrationName: MIGRATION,
          tenantId: TENANT,
          actorUserId: "user_alex",
        });

        expect(effect).toHaveBeenCalledWith({
          tenantId: TENANT,
          actorUserId: "user_alex",
        });
        expect(otherEffect).not.toHaveBeenCalled();
        // The pin lands first: it is what stops the next pass re-finalizing
        // the tenant, so it must not depend on the effect succeeding.
        expect(upserts).toHaveLength(1);
        expect(seen.pinsAtEffect).toBe(1);
      });

      it("propagates a failing effect to the operator while the pin holds", async () => {
        const { service, upserts } = serviceWith({
          record: finalized,
          rollbackEffects: {
            [MIGRATION]: async () => {
              throw new Error("the ledger refused the rollback command");
            },
          },
        });

        await expect(
          service.rollBack({
            migrationName: MIGRATION,
            tenantId: TENANT,
            actorUserId: "user_alex",
          }),
        ).rejects.toThrow("the ledger refused the rollback command");
        expect(upserts[0]?.status).toBe("rolled_back");
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

  describe("given a rollback whose effect failed after the pin landed", () => {
    const finalized: TenantMigrationRecord = {
      migrationName: MIGRATION,
      tenantId: TENANT,
      status: "finalized",
      report: { parity: "clean" },
    };

    /**
     * A service whose effect throws the FIRST time and succeeds after - the
     * incident shape the retry path exists for. The first call is left to the
     * test, so the rejection is asserted where it happened.
     */
    function serviceWhoseEffectFailsOnce() {
      const decisions: string[] = [];
      let failing = true;
      const effect = vi.fn(async ({ decidedAt }: { decidedAt: string }) => {
        decisions.push(decidedAt);
        if (failing) {
          failing = false;
          throw new Error("the ledger refused the rollback command");
        }
      });
      const { service, upserts } = serviceWith({
        record: finalized,
        rollbackEffects: { [MIGRATION]: effect },
      });
      const call = () =>
        service.rollBack({
          migrationName: MIGRATION,
          tenantId: TENANT,
          actorUserId: "user_alex",
        });
      return { call, effect, upserts, decisions };
    }

    describe("when the operator retries it", () => {
      it("re-runs the effect instead of refusing the already pinned record", async () => {
        const { call, effect, upserts } = serviceWhoseEffectFailsOnce();
        await expect(call()).rejects.toThrow(
          "the ledger refused the rollback command",
        );

        await call();

        expect(effect).toHaveBeenCalledTimes(2);
        // One pin, written by the first call and left alone by the retry:
        // the record was already off the engine's list of tenants to
        // re-finalize, and re-stamping it would move the decision moment.
        expect(upserts).toHaveLength(1);
        expect(upserts[0]?.status).toBe("rolled_back");
      });

      it("hands the effect the moment the rollback was decided, unchanged", async () => {
        const { call, decisions, upserts } = serviceWhoseEffectFailsOnce();
        await expect(call()).rejects.toThrow(
          "the ledger refused the rollback command",
        );

        await call();

        expect(decisions).toHaveLength(2);
        expect(decisions[1]).toBe(decisions[0]);
        const pinned = (upserts[0]?.report as Record<string, unknown>)
          .rolledBack as Record<string, unknown>;
        expect(pinned.at).toBe(decisions[0]);
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
});

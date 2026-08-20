import type { TenantMigrationRecord } from "@langwatch/system-migrations";
import { describe, expect, it, vi } from "vitest";
import {
  MigrationEnrollmentCloudOnlyError,
  MigrationEnrollmentOrganizationNotFoundError,
  MigrationRollbackRequiresMigratedOrFinalizedError,
  MigrationStateNotFoundError,
} from "../errors";
import {
  type SystemMigrationEnrollmentStore,
  SystemMigrationsService,
} from "../system-migrations.service";

const MIGRATION = "team-user-backfill";
const TENANT = "org_acme";

function enrollmentStoreStub() {
  return {
    findAllByStage: vi
      .fn<SystemMigrationEnrollmentStore["findAllByStage"]>()
      .mockResolvedValue([]),
    findOrganizationById: vi
      .fn<SystemMigrationEnrollmentStore["findOrganizationById"]>()
      .mockResolvedValue({ id: "org_acme", name: "Acme" }),
    create: vi
      .fn<SystemMigrationEnrollmentStore["create"]>()
      .mockResolvedValue(undefined),
    delete: vi
      .fn<SystemMigrationEnrollmentStore["delete"]>()
      .mockResolvedValue(undefined),
  };
}

function serviceWith({
  record,
  rollbackEffects,
  rollbackGuards,
  isSaaS = true,
  enrollments = enrollmentStoreStub(),
  migrations = [{ name: MIGRATION, runsAutomaticallyOnSelfHosted: true }],
  audit = vi.fn().mockResolvedValue(undefined),
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
  rollbackGuards?: Record<
    string,
    (args: { tenantId: string; record: TenantMigrationRecord }) => Promise<void>
  >;
  isSaaS?: boolean;
  enrollments?: ReturnType<typeof enrollmentStoreStub>;
  migrations?: Array<{ name: string; runsAutomaticallyOnSelfHosted: boolean }>;
  audit?: ReturnType<typeof vi.fn>;
}) {
  const upserts: TenantMigrationRecord[] = [];
  // Stored, not fixed: a rollback retry re-reads the record the previous call
  // pinned, so the stub has to answer with what was actually written.
  let stored = record;
  const state = {
    findStatusCounts: vi.fn().mockResolvedValue({
      migrated: 0,
      finalized: 0,
      parked: 0,
      rolled_back: 0,
    }),
    findRecordsByStatus: vi.fn().mockResolvedValue([]),
    findRecord: vi.fn().mockImplementation(() => Promise.resolve(stored)),
    upsertRecord: vi.fn().mockImplementation((written) => {
      stored = written as TenantMigrationRecord;
      upserts.push(written as TenantMigrationRecord);
      return Promise.resolve();
    }),
  };
  const service = new SystemMigrationsService({
    state,
    migrations: () => migrations,
    isSaaS: () => isSaaS,
    enrollments,
    audit,
    runPass: vi.fn(),
    ...(rollbackEffects ? { rollbackEffects } : {}),
    ...(rollbackGuards ? { rollbackGuards } : {}),
  });
  return { service, upserts, enrollments, audit };
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

        // `decidedAt` rides along so an effect can key a deduplicating
        // command id off the DECISION rather than the clock, which is what
        // makes a retry idempotent.
        expect(effect).toHaveBeenCalledWith({
          tenantId: TENANT,
          actorUserId: "user_alex",
          decidedAt: expect.any(String),
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

  describe("given a migration whose composition declares a rollback guard", () => {
    const finalized: TenantMigrationRecord = {
      migrationName: MIGRATION,
      tenantId: TENANT,
      status: "finalized",
      report: { parity: "clean" },
    };

    describe("when the guard refuses", () => {
      it("propagates the refusal before anything is pinned or run", async () => {
        const effect = vi.fn();
        const { service, upserts } = serviceWith({
          record: finalized,
          rollbackEffects: { [MIGRATION]: effect },
          rollbackGuards: {
            [MIGRATION]: async () => {
              throw new Error("another migration still stands on this one");
            },
          },
        });

        await expect(
          service.rollBack({
            migrationName: MIGRATION,
            tenantId: TENANT,
            actorUserId: "user_alex",
          }),
        ).rejects.toThrow("another migration still stands on this one");
        // A refusal leaves the tenant EXACTLY as the operator found it: no
        // pin to unpick, no effect half-applied.
        expect(upserts).toHaveLength(0);
        expect(effect).not.toHaveBeenCalled();
      });
    });

    describe("when the guard passes", () => {
      it("hands the guard the stored record and proceeds to the pin", async () => {
        const guard = vi.fn(async () => undefined);
        const { service, upserts } = serviceWith({
          record: finalized,
          rollbackGuards: { [MIGRATION]: guard },
        });

        await service.rollBack({
          migrationName: MIGRATION,
          tenantId: TENANT,
          actorUserId: "user_alex",
        });

        expect(guard).toHaveBeenCalledWith({
          tenantId: TENANT,
          record: finalized,
        });
        expect(upserts[0]?.status).toBe("rolled_back");
      });
    });

    describe("when the operator retries an already pinned rollback", () => {
      it("still runs the guard - a refusal holds however the operator arrived", async () => {
        const guard = vi.fn(async () => {
          throw new Error("still refused");
        });
        const { service } = serviceWith({
          record: {
            migrationName: MIGRATION,
            tenantId: TENANT,
            status: "rolled_back",
            report: { rolledBack: { by: "user_alex", at: "2026-01-01" } },
          },
          rollbackGuards: { [MIGRATION]: guard },
        });

        await expect(
          service.rollBack({
            migrationName: MIGRATION,
            tenantId: TENANT,
            actorUserId: "user_alex",
          }),
        ).rejects.toThrow("still refused");
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

describe("SystemMigrationsService enrollment", () => {
  describe("given a cloud installation", () => {
    describe("when an operator enrolls an existing organization", () => {
      it("writes the enrollment and audits who paced the rollout", async () => {
        const { service, enrollments, audit } = serviceWith({ record: null });

        await service.enroll({
          organizationId: "org_acme",
          stage: "cutover",
          actorUserId: "user_alex",
        });

        expect(enrollments.create).toHaveBeenCalledWith({
          organizationId: "org_acme",
          stage: "cutover",
          enrolledByUserId: "user_alex",
        });
        expect(audit).toHaveBeenCalledWith({
          userId: "user_alex",
          organizationId: "org_acme",
          action: "systemMigrations.enroll",
          args: { stage: "cutover" },
        });
      });

      /** @scenario "An enrollment lands even when its audit write fails" */
      it("returns normally when the audit write throws, since the enrollment already landed", async () => {
        const enrollments = enrollmentStoreStub();
        const audit = vi.fn().mockRejectedValue(new Error("connection reset"));
        const { service } = serviceWith({ record: null, enrollments, audit });

        await expect(
          service.enroll({
            organizationId: "org_acme",
            stage: "cutover",
            actorUserId: "user_alex",
          }),
        ).resolves.toBeUndefined();

        expect(enrollments.create).toHaveBeenCalledWith({
          organizationId: "org_acme",
          stage: "cutover",
          enrolledByUserId: "user_alex",
        });
      });
    });

    describe("when the organization id matches nothing", () => {
      /** @scenario "Enrolling an organization that does not exist is refused" */
      it("refuses with organization_not_found and writes nothing", async () => {
        const enrollments = enrollmentStoreStub();
        enrollments.findOrganizationById.mockResolvedValue(null);
        const { service } = serviceWith({ record: null, enrollments });

        const attempt = service.enroll({
          organizationId: "org_typo",
          stage: "migrations",
          actorUserId: "user_alex",
        });

        await expect(attempt).rejects.toThrow(
          MigrationEnrollmentOrganizationNotFoundError,
        );
        await attempt.catch(
          (error: MigrationEnrollmentOrganizationNotFoundError) => {
            expect(error.code).toBe("organization_not_found");
          },
        );
        expect(enrollments.create).not.toHaveBeenCalled();
      });
    });

    describe("when an operator withdraws an enrollment", () => {
      it("deletes the row and audits the withdrawal", async () => {
        const { service, enrollments, audit } = serviceWith({ record: null });

        await service.withdraw({
          organizationId: "org_acme",
          stage: "migrations",
          actorUserId: "user_alex",
        });

        expect(enrollments.delete).toHaveBeenCalledWith({
          organizationId: "org_acme",
          stage: "migrations",
        });
        expect(audit).toHaveBeenCalledWith({
          userId: "user_alex",
          organizationId: "org_acme",
          action: "systemMigrations.withdraw",
          args: { stage: "migrations" },
        });
      });

      /** @scenario "A withdrawal lands even when its audit write fails" */
      it("returns normally when the audit write throws, since the withdrawal already landed", async () => {
        const enrollments = enrollmentStoreStub();
        const audit = vi.fn().mockRejectedValue(new Error("connection reset"));
        const { service } = serviceWith({ record: null, enrollments, audit });

        await expect(
          service.withdraw({
            organizationId: "org_acme",
            stage: "migrations",
            actorUserId: "user_alex",
          }),
        ).resolves.toBeUndefined();

        expect(enrollments.delete).toHaveBeenCalledWith({
          organizationId: "org_acme",
          stage: "migrations",
        });
      });
    });
  });

  describe("given a self-hosted installation", () => {
    describe("when an operator tries to enroll or withdraw", () => {
      /** @scenario "Enrollment does not apply to self-hosted installations" */
      it("refuses both with migration_enrollment_cloud_only and touches nothing", async () => {
        const { service, enrollments, audit } = serviceWith({
          record: null,
          isSaaS: false,
        });

        // Thunks, not promises: an eagerly created second promise would
        // reject before its handler attaches, tripping the unhandled-
        // rejection watchdog even though the test passes.
        for (const attempt of [
          () =>
            service.enroll({
              organizationId: "org_acme",
              stage: "migrations",
              actorUserId: "user_alex",
            }),
          () =>
            service.withdraw({
              organizationId: "org_acme",
              stage: "migrations",
              actorUserId: "user_alex",
            }),
        ]) {
          const rejection = attempt();
          await expect(rejection).rejects.toBeInstanceOf(
            MigrationEnrollmentCloudOnlyError,
          );
          await expect(rejection).rejects.toMatchObject({
            code: "migration_enrollment_cloud_only",
          });
        }
        expect(enrollments.create).not.toHaveBeenCalled();
        expect(enrollments.delete).not.toHaveBeenCalled();
        expect(audit).not.toHaveBeenCalled();
      });
    });
  });

  describe("when the ops page lists enrollments", () => {
    it("answers both stages flattened, with the installation shape alongside", async () => {
      const createdAt = new Date("2026-08-19T10:00:00Z");
      const enrollments = enrollmentStoreStub();
      enrollments.findAllByStage.mockImplementation(
        ({ stage }: { stage: string }) =>
          Promise.resolve(
            stage === "migrations"
              ? [
                  {
                    organizationId: "org_acme",
                    organizationName: "Acme",
                    stage,
                    enrolledByUserId: "user_alex",
                    enrolledByLabel: "Alex",
                    createdAt,
                  },
                ]
              : [],
          ),
      );
      const { service } = serviceWith({ record: null, enrollments });

      const listing = await service.getEnrollments({
        requestedBy: "user_ops",
      });

      expect(listing.isSaaS).toBe(true);
      expect(listing.enrollments).toHaveLength(1);
      expect(listing.enrollments[0]).toMatchObject({
        organizationId: "org_acme",
        stage: "migrations",
      });
      expect(enrollments.findAllByStage).toHaveBeenCalledWith({
        stage: "migrations",
      });
      expect(enrollments.findAllByStage).toHaveBeenCalledWith({
        stage: "cutover",
      });
    });

    it("audits the read, because the listing carries the enrollers' names", async () => {
      const { service, audit } = serviceWith({ record: null });

      await service.getEnrollments({ requestedBy: "user_ops" });

      expect(audit).toHaveBeenCalledWith({
        userId: "user_ops",
        action: "systemMigrations.listEnrollments",
      });
    });

    /** @scenario "An enrollment listing is returned even when its audit write fails" */
    it("answers the listing when the audit write throws, since the read already happened", async () => {
      const audit = vi.fn().mockRejectedValue(new Error("connection reset"));
      const { service } = serviceWith({ record: null, audit });

      await expect(
        service.getEnrollments({ requestedBy: "user_ops" }),
      ).resolves.toMatchObject({ isSaaS: true, enrollments: [] });
    });
  });

  describe("when the overview is read on a self-hosted installation", () => {
    /** @scenario "Self-hosted installations run the preparation work but not the cutover yet" */
    it("marks an unreleased migration unavailable so waiting reads as normal, not as attention", async () => {
      const { service } = serviceWith({
        record: null,
        isSaaS: false,
        migrations: [
          { name: "released", runsAutomaticallyOnSelfHosted: true },
          { name: "unreleased", runsAutomaticallyOnSelfHosted: false },
        ],
      });

      const overview = await service.getOverview();

      expect(
        overview.map(({ name, availableOnThisInstallation }) => ({
          name,
          availableOnThisInstallation,
        })),
      ).toEqual([
        { name: "released", availableOnThisInstallation: true },
        { name: "unreleased", availableOnThisInstallation: false },
      ]);
    });

    it("marks everything available on cloud, whatever the declarations say", async () => {
      const { service } = serviceWith({
        record: null,
        isSaaS: true,
        migrations: [
          { name: "unreleased", runsAutomaticallyOnSelfHosted: false },
        ],
      });

      const overview = await service.getOverview();

      expect(overview[0]?.availableOnThisInstallation).toBe(true);
    });
  });
});

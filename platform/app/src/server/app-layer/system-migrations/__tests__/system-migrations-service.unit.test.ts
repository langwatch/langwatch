import type {
  MigrationPassSummary,
  TenantMigrationRecord,
} from "@langwatch/system-migrations";
import { describe, expect, it, vi } from "vitest";
import {
  MigrationEnrollmentCloudOnlyError,
  MigrationEnrollmentOrganizationNotFoundError,
  MigrationPassAlreadyRunningError,
  MigrationRollbackRequiresMigratedOrFinalizedError,
  MigrationRunRequiresEnrollmentError,
  MigrationStateNotFoundError,
  MigrationUnknownError,
} from "../errors";
import {
  type SystemMigrationEnrollmentStore,
  SystemMigrationsService,
} from "../system-migrations.service";

const MIGRATION = "team-user-backfill";
const TENANT = "org_acme";

function migrationOf({
  name,
  runsAutomaticallyOnSelfHosted = true,
  enrolledAutomatically = false,
  requiresOperatorConfirmation = false,
  tenant,
}: {
  name: string;
  runsAutomaticallyOnSelfHosted?: boolean;
  enrolledAutomatically?: boolean;
  requiresOperatorConfirmation?: boolean;
  tenant?: "organization" | "user";
}) {
  return {
    name,
    title: name,
    description: name,
    requiresOperatorConfirmation,
    runsAutomaticallyOnSelfHosted,
    enrolledAutomatically,
    ...(tenant ? { tenant } : {}),
  };
}

function enrollmentStoreStub() {
  return {
    findAll: vi
      .fn<SystemMigrationEnrollmentStore["findAll"]>()
      .mockResolvedValue([]),
    findOrganizationById: vi
      .fn<SystemMigrationEnrollmentStore["findOrganizationById"]>()
      .mockResolvedValue({ id: "org_acme", name: "Acme" }),
    isEnrolled: vi
      .fn<SystemMigrationEnrollmentStore["isEnrolled"]>()
      .mockResolvedValue(true),
    countEnrolledByMigration: vi
      .fn<SystemMigrationEnrollmentStore["countEnrolledByMigration"]>()
      .mockResolvedValue(new Map()),
    countOrganizations: vi
      .fn<SystemMigrationEnrollmentStore["countOrganizations"]>()
      .mockResolvedValue(0),
    searchOrganizations: vi
      .fn<SystemMigrationEnrollmentStore["searchOrganizations"]>()
      .mockResolvedValue([]),
    create: vi
      .fn<SystemMigrationEnrollmentStore["create"]>()
      .mockResolvedValue(undefined),
    findCohortEligibleOrganizations: vi
      .fn<SystemMigrationEnrollmentStore["findCohortEligibleOrganizations"]>()
      .mockResolvedValue([]),
    createMany: vi
      .fn<SystemMigrationEnrollmentStore["createMany"]>()
      .mockResolvedValue({ insertedCount: 0 }),
    delete: vi
      .fn<SystemMigrationEnrollmentStore["delete"]>()
      .mockResolvedValue(undefined),
  };
}

function targetedPassStub() {
  return vi
    .fn<
      (args: {
        organizationId: string;
        migrationName: string;
      }) => Promise<MigrationPassSummary>
    >()
    .mockResolvedValue({
      tenantsSeen: 1,
      finalized: 1,
      held: 0,
      parked: 0,
      skipped: 0,
      alreadyFinalized: 0,
      alreadyRolledBack: 0,
      claimed: 0,
    });
}

function serviceWith({
  record,
  waitingReports,
  rollbackEffects,
  rollbackGuards,
  isSaaS = true,
  enrollments = enrollmentStoreStub(),
  migrations = [migrationOf({ name: MIGRATION })],
  runTargetedPass = targetedPassStub(),
  privateDataplaneOrganizationIds = [],
}: {
  record: TenantMigrationRecord | null;
  waitingReports?: Record<string, (report: unknown) => boolean>;
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
  migrations?: Array<ReturnType<typeof migrationOf>>;
  runTargetedPass?: ReturnType<typeof targetedPassStub>;
  privateDataplaneOrganizationIds?: string[];
}) {
  const upserts: TenantMigrationRecord[] = [];
  const audit = vi.fn().mockResolvedValue(undefined);
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
    privateDataplaneOrganizationIds: () => privateDataplaneOrganizationIds,
    audit,
    runPass: vi.fn(),
    runTargetedPass,
    ...(waitingReports ? { waitingReports } : {}),
    ...(rollbackEffects ? { rollbackEffects } : {}),
    ...(rollbackGuards ? { rollbackGuards } : {}),
  });
  return { service, upserts, enrollments, audit, runTargetedPass };
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
          migrationName: MIGRATION,
          actorUserId: "user_alex",
        });

        expect(enrollments.create).toHaveBeenCalledWith({
          organizationId: "org_acme",
          migrationName: MIGRATION,
          enrolledByUserId: "user_alex",
        });
        expect(audit).toHaveBeenCalledWith({
          userId: "user_alex",
          organizationId: "org_acme",
          action: "systemMigrations.enroll",
          args: { migrationName: MIGRATION },
        });
      });
    });

    describe("when the migration name matches nothing registered", () => {
      /** @scenario "Enrolling for a migration that does not exist is refused" */
      it("refuses with migration_unknown and writes nothing", async () => {
        const { service, enrollments } = serviceWith({ record: null });

        const attempt = service.enroll({
          organizationId: "org_acme",
          migrationName: "no-such-migration",
          actorUserId: "user_alex",
        });

        await expect(attempt).rejects.toThrow(MigrationUnknownError);
        expect(enrollments.create).not.toHaveBeenCalled();
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
          migrationName: MIGRATION,
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
          migrationName: MIGRATION,
          actorUserId: "user_alex",
        });

        expect(enrollments.delete).toHaveBeenCalledWith({
          organizationId: "org_acme",
          migrationName: MIGRATION,
        });
        expect(audit).toHaveBeenCalledWith({
          userId: "user_alex",
          organizationId: "org_acme",
          action: "systemMigrations.withdraw",
          args: { migrationName: MIGRATION },
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
              migrationName: MIGRATION,
              actorUserId: "user_alex",
            }),
          () =>
            service.withdraw({
              organizationId: "org_acme",
              migrationName: MIGRATION,
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
    it("answers every migration's rows, with the installation shape alongside", async () => {
      const createdAt = new Date("2026-08-19T10:00:00Z");
      const enrollments = enrollmentStoreStub();
      enrollments.findAll.mockResolvedValue([
        {
          organizationId: "org_acme",
          organizationName: "Acme",
          migrationName: MIGRATION,
          enrolledByUserId: "user_alex",
          enrolledByLabel: "Alex",
          createdAt,
        },
      ]);
      const { service } = serviceWith({ record: null, enrollments });

      const listing = await service.getEnrollments({
        requestedBy: "user_ops",
      });

      expect(listing.isSaaS).toBe(true);
      expect(listing.enrollments).toHaveLength(1);
      expect(listing.enrollments[0]).toMatchObject({
        organizationId: "org_acme",
        migrationName: MIGRATION,
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
  });

  describe("when the overview is read on a self-hosted installation", () => {
    /** @scenario "Self-hosted installations run the preparation work but not the cutover yet" */
    it("marks an unreleased migration unavailable so waiting reads as normal, not as attention", async () => {
      const { service } = serviceWith({
        record: null,
        isSaaS: false,
        migrations: [
          migrationOf({
            name: "released",
            runsAutomaticallyOnSelfHosted: true,
          }),
          migrationOf({
            name: "unreleased",
            runsAutomaticallyOnSelfHosted: false,
          }),
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
      // Enrollment does not exist off cloud, so the gauge is honestly null
      // rather than a zero that reads as "nobody enrolled yet".
      expect(overview[0]?.enrollment).toBeNull();
    });

    it("marks everything available on cloud, whatever the declarations say", async () => {
      const { service } = serviceWith({
        record: null,
        isSaaS: true,
        migrations: [
          migrationOf({
            name: "unreleased",
            runsAutomaticallyOnSelfHosted: false,
          }),
        ],
      });

      const overview = await service.getOverview();

      expect(overview[0]?.availableOnThisInstallation).toBe(true);
    });
  });

  describe("when the overview is read on cloud", () => {
    /** @scenario "Each migration presents a title and a description, in running order" */
    it("carries each migration's title and description, in registration order", async () => {
      const { service } = serviceWith({
        record: null,
        migrations: [
          {
            name: "first",
            title: "First step",
            description: "What the first step does.",
            requiresOperatorConfirmation: false,
            runsAutomaticallyOnSelfHosted: true,
            enrolledAutomatically: false,
          },
          {
            name: "second",
            title: "Second step",
            description: "What the second step does.",
            requiresOperatorConfirmation: false,
            runsAutomaticallyOnSelfHosted: true,
            enrolledAutomatically: false,
          },
        ],
      });

      const overview = await service.getOverview();

      expect(
        overview.map(({ name, title, description }) => ({
          name,
          title,
          description,
        })),
      ).toEqual([
        {
          name: "first",
          title: "First step",
          description: "What the first step does.",
        },
        {
          name: "second",
          title: "Second step",
          description: "What the second step does.",
        },
      ]);
    });

    /** @scenario "The page shows how many organizations each migration could still enroll" */
    it("gauges each migration's enrolled and not-enrolled organizations", async () => {
      const enrollments = enrollmentStoreStub();
      enrollments.countEnrolledByMigration.mockResolvedValue(
        new Map([[MIGRATION, 1]]),
      );
      enrollments.countOrganizations.mockResolvedValue(3);
      const { service } = serviceWith({ record: null, enrollments });

      const overview = await service.getOverview();

      expect(overview[0]?.enrollment).toEqual({
        enrolledCount: 1,
        notEnrolledCount: 2,
      });
    });
  });
});

describe("SystemMigrationsService.runForOrganization", () => {
  describe("given an enrolled organization on cloud", () => {
    /** @scenario "An operator runs the migration for one organization now" */
    it("runs the targeted pass and answers the status the organization ended in", async () => {
      const { service, runTargetedPass } = serviceWith({
        record: {
          migrationName: MIGRATION,
          tenantId: TENANT,
          status: "finalized",
          report: null,
        },
      });

      const outcome = await service.runForOrganization({
        organizationId: TENANT,
        migrationName: MIGRATION,
        actorUserId: "user_alex",
      });

      expect(runTargetedPass).toHaveBeenCalledWith({
        organizationId: TENANT,
        migrationName: MIGRATION,
      });
      expect(outcome).toEqual({ status: "finalized", waiting: false });
    });
  });

  describe("given a step that only waited on its prerequisites", () => {
    /** @scenario "A targeted run that only waited says so, rather than reporting a held organization" */
    it("answers that it is waiting, not that it is held for review", async () => {
      const { service } = serviceWith({
        // The state machine has no waiting status: a waiting step records
        // `migrated` exactly as a held one does, and only its report
        // separates them.
        record: {
          migrationName: MIGRATION,
          tenantId: TENANT,
          status: "migrated",
          report: { kind: "cutover_waiting", awaiting: ["earlier-step"] },
        },
        waitingReports: {
          [MIGRATION]: (report) =>
            (report as { kind?: string } | null)?.kind === "cutover_waiting",
        },
      });

      const outcome = await service.runForOrganization({
        organizationId: TENANT,
        migrationName: MIGRATION,
        actorUserId: "user_alex",
      });

      expect(outcome).toEqual({ status: "migrated", waiting: true });
    });
  });

  describe("given an organization that is not enrolled on cloud", () => {
    /** @scenario "A targeted run for an organization that is not enrolled is refused" */
    it("refuses with migration_run_requires_enrollment and runs nothing", async () => {
      const enrollments = enrollmentStoreStub();
      enrollments.isEnrolled.mockResolvedValue(false);
      const { service, runTargetedPass } = serviceWith({
        record: null,
        enrollments,
      });

      const attempt = service.runForOrganization({
        organizationId: TENANT,
        migrationName: MIGRATION,
        actorUserId: "user_alex",
      });

      await expect(attempt).rejects.toThrow(
        MigrationRunRequiresEnrollmentError,
      );
      expect(runTargetedPass).not.toHaveBeenCalled();
    });
  });

  describe("given a migration name nothing registered answers to", () => {
    it("refuses with migration_unknown and runs nothing", async () => {
      const { service, runTargetedPass } = serviceWith({ record: null });

      await expect(
        service.runForOrganization({
          organizationId: TENANT,
          migrationName: "no-such-migration",
          actorUserId: "user_alex",
        }),
      ).rejects.toThrow(MigrationUnknownError);
      expect(runTargetedPass).not.toHaveBeenCalled();
    });
  });

  describe("when another pass holds the organization's claim", () => {
    /** @scenario "A targeted run while a pass is already running is refused" */
    it("refuses with migration_pass_already_running", async () => {
      const { service } = serviceWith({
        record: null,
        runTargetedPass: targetedPassStub().mockResolvedValue({
          tenantsSeen: 1,
          finalized: 0,
          held: 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 1,
        }),
      });

      await expect(
        service.runForOrganization({
          organizationId: TENANT,
          migrationName: MIGRATION,
          actorUserId: "user_alex",
        }),
      ).rejects.toThrow(MigrationPassAlreadyRunningError);
    });
  });

  describe("when one member of a user-rooted run is claimed and the rest finish", () => {
    /** @scenario "One contended member does not discard a user-rooted run's outcome" */
    it("reports the organization instead of discarding the members that finalized", async () => {
      const { service } = serviceWith({
        record: null,
        migrations: [migrationOf({ name: MIGRATION, tenant: "user" })],
        runTargetedPass: targetedPassStub().mockResolvedValue({
          tenantsSeen: 2,
          finalized: 1,
          held: 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 1,
        }),
      });

      // A user-rooted run's tenants are the organization's members, so one
      // contended member is partial progress. Aborting on it would throw away
      // the outcome of every member that finished — and the contended one
      // keeps the organization on the operator's list until the next pass.
      const outcome = await service.runForOrganization({
        organizationId: TENANT,
        migrationName: MIGRATION,
        actorUserId: "user_alex",
      });

      expect(outcome).toEqual({ status: "migrated", waiting: false });
    });

    it("still refuses when EVERY member was claimed, because the run did nothing", async () => {
      const { service } = serviceWith({
        record: null,
        migrations: [migrationOf({ name: MIGRATION, tenant: "user" })],
        runTargetedPass: targetedPassStub().mockResolvedValue({
          tenantsSeen: 2,
          finalized: 0,
          held: 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 2,
        }),
      });

      await expect(
        service.runForOrganization({
          organizationId: TENANT,
          migrationName: MIGRATION,
          actorUserId: "user_alex",
        }),
      ).rejects.toThrow(MigrationPassAlreadyRunningError);
    });
  });

  describe("given a user-rooted migration whose members are all already terminal", () => {
    it("answers finalized rather than pretending no member was in the cohort", async () => {
      const { service } = serviceWith({
        record: null,
        migrations: [migrationOf({ name: MIGRATION, tenant: "user" })],
        runTargetedPass: targetedPassStub().mockResolvedValue({
          tenantsSeen: 3,
          finalized: 0,
          held: 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 3,
          alreadyRolledBack: 0,
          claimed: 0,
        }),
      });

      const outcome = await service.runForOrganization({
        organizationId: TENANT,
        migrationName: MIGRATION,
        actorUserId: "user_alex",
      });

      expect(outcome).toEqual({ status: "finalized", waiting: false });
    });

    it("answers rolled_back when the members were rolled back, never finalized", async () => {
      const { service } = serviceWith({
        record: null,
        migrations: [migrationOf({ name: MIGRATION, tenant: "user" })],
        runTargetedPass: targetedPassStub().mockResolvedValue({
          tenantsSeen: 3,
          finalized: 0,
          held: 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 3,
          claimed: 0,
        }),
      });

      const outcome = await service.runForOrganization({
        organizationId: TENANT,
        migrationName: MIGRATION,
        actorUserId: "user_alex",
      });

      expect(outcome).toEqual({ status: "rolled_back", waiting: false });
    });

    it("still answers null for a run where no member was in the cohort at all", async () => {
      const { service } = serviceWith({
        record: null,
        migrations: [migrationOf({ name: MIGRATION, tenant: "user" })],
        runTargetedPass: targetedPassStub().mockResolvedValue({
          tenantsSeen: 0,
          finalized: 0,
          held: 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 0,
        }),
      });

      const outcome = await service.runForOrganization({
        organizationId: TENANT,
        migrationName: MIGRATION,
        actorUserId: "user_alex",
      });

      expect(outcome).toEqual({ status: null, waiting: false });
    });
  });

  describe("given a self-hosted installation and an unreleased migration", () => {
    it("refuses with migration_not_available_on_installation", async () => {
      const { service, runTargetedPass } = serviceWith({
        record: null,
        isSaaS: false,
        migrations: [
          migrationOf({
            name: MIGRATION,
            runsAutomaticallyOnSelfHosted: false,
          }),
        ],
      });

      await expect(
        service.runForOrganization({
          organizationId: TENANT,
          migrationName: MIGRATION,
          actorUserId: "user_alex",
        }),
      ).rejects.toMatchObject({
        code: "migration_not_available_on_installation",
      });
      expect(runTargetedPass).not.toHaveBeenCalled();
    });
  });
});

describe("SystemMigrationsService and a migration enrolled automatically", () => {
  const AUTOMATIC = "authz-engine";
  const automaticMigration = migrationOf({
    name: AUTOMATIC,
    enrolledAutomatically: true,
  });

  describe("given the ops page reads the overview", () => {
    /** @scenario "The migrations page is told there is nothing to enroll" */
    it("says the migration is automatic and reports no enrollment gauge", async () => {
      const { service } = serviceWith({
        record: null,
        migrations: [automaticMigration],
      });

      const overview = await service.getOverview();

      expect(overview[0]?.enrolledAutomatically).toBe(true);
      // A gauge here would count rows that decide nothing, and "Not enrolled
      // 4,231" would read as a rollout that had barely started.
      expect(overview[0]?.enrollment).toBeNull();
    });
  });

  describe("when an operator enrolls one organization for it", () => {
    /** @scenario "Enrolling an organization for an automatically enrolled migration is refused" */
    it("refuses and writes no row", async () => {
      const { service, enrollments } = serviceWith({
        record: null,
        migrations: [automaticMigration],
      });

      await expect(
        service.enroll({
          organizationId: TENANT,
          migrationName: AUTOMATIC,
          actorUserId: "user_ops",
        }),
      ).rejects.toMatchObject({ code: "migration_enrolled_automatically" });
      expect(enrollments.create).not.toHaveBeenCalled();
    });
  });

  describe("when an operator enrolls a cohort for it", () => {
    /** @scenario "Enrolling an organization for an automatically enrolled migration is refused" */
    it("refuses before drawing a sample", async () => {
      const { service, enrollments } = serviceWith({
        record: null,
        migrations: [automaticMigration],
      });

      await expect(
        service.enrollCohort({
          migrationName: AUTOMATIC,
          sampleSize: 5,
          actorUserId: "user_ops",
        }),
      ).rejects.toMatchObject({ code: "migration_enrolled_automatically" });
      expect(
        enrollments.findCohortEligibleOrganizations,
      ).not.toHaveBeenCalled();
      expect(enrollments.createMany).not.toHaveBeenCalled();
    });
  });

  describe("when an operator withdraws an organization from it", () => {
    /** @scenario "Withdrawing from an automatically enrolled migration is refused" */
    it("refuses rather than deleting a row that pauses nothing", async () => {
      const { service, enrollments } = serviceWith({
        record: null,
        migrations: [automaticMigration],
      });

      await expect(
        service.withdraw({
          organizationId: TENANT,
          migrationName: AUTOMATIC,
          actorUserId: "user_ops",
        }),
      ).rejects.toMatchObject({ code: "migration_enrolled_automatically" });
      expect(enrollments.delete).not.toHaveBeenCalled();
    });
  });

  describe("when an operator runs it for one organization nothing enrolled", () => {
    /** @scenario "A targeted run needs no enrollment for an automatically enrolled migration" */
    it("runs it without consulting enrollment at all", async () => {
      const enrollments = enrollmentStoreStub();
      enrollments.isEnrolled.mockResolvedValue(false);
      const { service, runTargetedPass } = serviceWith({
        record: null,
        enrollments,
        migrations: [automaticMigration],
      });

      await service.runForOrganization({
        organizationId: TENANT,
        migrationName: AUTOMATIC,
        actorUserId: "user_ops",
      });

      expect(runTargetedPass).toHaveBeenCalledWith({
        organizationId: TENANT,
        migrationName: AUTOMATIC,
      });
      expect(enrollments.isEnrolled).not.toHaveBeenCalled();
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  type SystemMigrationEnrollmentStore,
  SystemMigrationsService,
} from "../system-migrations.service";

const MIGRATION = "authz-grants-genesis-import";

function organizations(count: number): Array<{ id: string; name: string }> {
  return Array.from({ length: count }, (_, index) => ({
    id: `org_${index}`,
    name: `Org ${index}`,
  }));
}

function serviceWith({
  eligible = organizations(10),
  isSaaS = true,
  privateDataplaneOrganizationIds = [],
  migrationNames = [MIGRATION],
}: {
  eligible?: Array<{ id: string; name: string }>;
  isSaaS?: boolean;
  privateDataplaneOrganizationIds?: string[];
  /** Registered migrations, in the order they run per organization. */
  migrationNames?: string[];
} = {}) {
  const findCohortEligibleOrganizations = vi
    .fn<SystemMigrationEnrollmentStore["findCohortEligibleOrganizations"]>()
    .mockResolvedValue(eligible);
  const createMany = vi
    .fn<SystemMigrationEnrollmentStore["createMany"]>()
    .mockImplementation(async ({ organizationIds }) => ({
      insertedCount: organizationIds.length,
    }));
  const audit = vi.fn().mockResolvedValue(undefined);
  const service = new SystemMigrationsService({
    state: {
      findStatusCounts: vi.fn(),
      findRecordsByStatus: vi.fn(),
      findRecord: vi.fn(),
      upsertRecord: vi.fn(),
    },
    migrations: () =>
      migrationNames.map((name) => ({
        name,
        title: name,
        description: name,
        requiresOperatorConfirmation: false,
        runsAutomaticallyOnSelfHosted: false,
      })),
    isSaaS: () => isSaaS,
    enrollments: {
      findAll: vi.fn(),
      findOrganizationById: vi.fn(),
      isEnrolled: vi.fn(),
      countEnrolledByMigration: vi.fn(),
      countOrganizations: vi.fn(),
      searchOrganizations: vi.fn(),
      create: vi.fn(),
      findCohortEligibleOrganizations,
      createMany,
      delete: vi.fn(),
    },
    privateDataplaneOrganizationIds: () => privateDataplaneOrganizationIds,
    audit,
    runPass: vi.fn(),
    runTargetedPass: vi.fn(),
  });
  return { service, findCohortEligibleOrganizations, createMany, audit };
}

describe("SystemMigrationsService.enrollCohort", () => {
  describe("given a cloud installation with eligible organizations", () => {
    describe("when an operator enrolls a cohort", () => {
      /** @scenario "An operator enrolls a sampled cohort in one action" */
      it("enrolls the requested number in one write and names every pick", async () => {
        const { service, createMany } = serviceWith({
          eligible: organizations(200),
        });

        const result = await service.enrollCohort({
          migrationName: MIGRATION,
          sampleSize: 50,
          actorUserId: "user_ops",
        });

        expect(result.enrolled).toHaveLength(50);
        expect(result.eligibleCount).toBe(200);
        // A sample, not an echo: no repeats, and every pick from the pool.
        const pickedIds = result.enrolled.map(
          (organization) => organization.id,
        );
        expect(new Set(pickedIds).size).toBe(50);
        const poolIds = new Set(
          organizations(200).map((organization) => organization.id),
        );
        for (const id of pickedIds) {
          expect(poolIds.has(id)).toBe(true);
        }
        expect(createMany).toHaveBeenCalledTimes(1);
        expect(createMany.mock.calls[0]?.[0]).toMatchObject({
          migrationName: MIGRATION,
          enrolledByUserId: "user_ops",
        });
        expect(createMany.mock.calls[0]?.[0]?.organizationIds).toEqual(
          result.enrolled.map((organization) => organization.id),
        );
      });

      /** @scenario "A cohort never includes an enterprise organization" */
      it("asks the pool to exclude the private-dataplane organizations from the environment", async () => {
        const { service, findCohortEligibleOrganizations } = serviceWith({
          privateDataplaneOrganizationIds: ["org_isolated_inc"],
        });

        await service.enrollCohort({
          migrationName: MIGRATION,
          sampleSize: 5,
          actorUserId: "user_ops",
        });

        expect(findCohortEligibleOrganizations).toHaveBeenCalledWith({
          migrationName: MIGRATION,
          enrolledForMigrationName: undefined,
          excludeOrganizationIds: ["org_isolated_inc"],
        });
      });

      /** @scenario "A later step's cohort samples only organizations enrolled for the step before it" */
      it("pools a later step from the step before it, and the first step from everyone", async () => {
        const { service, findCohortEligibleOrganizations } = serviceWith({
          migrationNames: ["authz-team-user-backfill", MIGRATION],
        });

        await service.enrollCohort({
          migrationName: MIGRATION,
          sampleSize: 5,
          actorUserId: "user_ops",
        });
        expect(findCohortEligibleOrganizations).toHaveBeenLastCalledWith(
          expect.objectContaining({
            migrationName: MIGRATION,
            enrolledForMigrationName: "authz-team-user-backfill",
          }),
        );

        await service.enrollCohort({
          migrationName: "authz-team-user-backfill",
          sampleSize: 5,
          actorUserId: "user_ops",
        });
        expect(findCohortEligibleOrganizations).toHaveBeenLastCalledWith(
          expect.objectContaining({
            migrationName: "authz-team-user-backfill",
            enrolledForMigrationName: undefined,
          }),
        );
      });
    });

    describe("when fewer eligible organizations remain than the requested size", () => {
      /** @scenario "A cohort larger than the eligible pool enrolls the whole pool" */
      it("enrolls the whole pool and reports the smaller count", async () => {
        const { service } = serviceWith({ eligible: organizations(3) });

        const result = await service.enrollCohort({
          migrationName: MIGRATION,
          sampleSize: 50,
          actorUserId: "user_ops",
        });

        expect(result.enrolled).toHaveLength(3);
        expect(result.eligibleCount).toBe(3);
      });
    });

    describe("when the cohort action is audited", () => {
      it("records one row per organization, carrying that organization's id", async () => {
        const { service, audit } = serviceWith({
          eligible: organizations(2),
        });

        const result = await service.enrollCohort({
          migrationName: MIGRATION,
          sampleSize: 2,
          actorUserId: "user_ops",
        });

        // Per-organization rows, never one row holding an id array: the
        // indexed organizationId column is how the trail answers "what
        // touched org X", and a single row's args are size-capped.
        expect(audit).toHaveBeenCalledTimes(2);
        for (const organization of result.enrolled) {
          expect(audit).toHaveBeenCalledWith(
            expect.objectContaining({
              userId: "user_ops",
              organizationId: organization.id,
              action: "systemMigrations.enrollCohort",
              args: expect.objectContaining({
                migrationName: MIGRATION,
                cohortSize: 2,
              }),
            }),
          );
        }
      });
    });
  });

  describe("given a self-hosted installation", () => {
    describe("when an operator enrolls a cohort", () => {
      /** @scenario "Cohort enrollment does not apply to self-hosted installations" */
      it("refuses with the enrollment's cloud-only error", async () => {
        const { service, createMany } = serviceWith({ isSaaS: false });

        await expect(
          service.enrollCohort({
            migrationName: MIGRATION,
            sampleSize: 5,
            actorUserId: "user_ops",
          }),
        ).rejects.toMatchObject({ code: "migration_enrollment_cloud_only" });
        expect(createMany).not.toHaveBeenCalled();
      });
    });
  });
});

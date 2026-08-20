import { describe, expect, it, vi } from "vitest";
import { MigrationEnrollmentCloudOnlyError } from "../errors";
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
}: {
  eligible?: Array<{ id: string; name: string }>;
  isSaaS?: boolean;
  privateDataplaneOrganizationIds?: string[];
} = {}) {
  const findCohortEligibleOrganizations = vi
    .fn<SystemMigrationEnrollmentStore["findCohortEligibleOrganizations"]>()
    .mockResolvedValue(eligible);
  const createMany = vi
    .fn<SystemMigrationEnrollmentStore["createMany"]>()
    .mockResolvedValue(undefined);
  const audit = vi.fn().mockResolvedValue(undefined);
  const service = new SystemMigrationsService({
    state: {
      findStatusCounts: vi.fn(),
      findRecordsByStatus: vi.fn(),
      findRecord: vi.fn(),
      upsertRecord: vi.fn(),
    },
    migrations: () => [
      {
        name: MIGRATION,
        title: MIGRATION,
        description: MIGRATION,
        requiresOperatorConfirmation: false,
        runsAutomaticallyOnSelfHosted: false,
      },
    ],
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
          excludeOrganizationIds: ["org_isolated_inc"],
        });
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
      it("records the picked organization ids on the trail", async () => {
        const { service, audit } = serviceWith({
          eligible: organizations(2),
        });

        const result = await service.enrollCohort({
          migrationName: MIGRATION,
          sampleSize: 2,
          actorUserId: "user_ops",
        });

        expect(audit).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "user_ops",
            action: "systemMigrations.enrollCohort",
            args: expect.objectContaining({
              organizationIds: result.enrolled.map(
                (organization) => organization.id,
              ),
            }),
          }),
        );
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
        ).rejects.toBeInstanceOf(MigrationEnrollmentCloudOnlyError);
        expect(createMany).not.toHaveBeenCalled();
      });
    });
  });
});
